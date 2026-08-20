# Agent Core V3 架构方案

状态：设计定稿（2026-08-20）
前置讨论结论：移除模型可见 shell 与部署面 CLI；保留 Codex 循环骨架与 Master/Sub 契约流；任务级 tools API 作为扩展项。

## 1. 目标

- 新建独立包 `agent-core`，成为服务器上唯一的 agent 运行时：AgentLoop + 三层记忆 + skills tool call。
- 模型可见工具表中不存在任何通用执行能力（shell / apply_patch / cat）。
- `open-codex-source`（CLI TUI、Ink、sandbox、exec 白名单）整体移出部署面。
- Python skills、Gateway 业务闭环、Master/Sub 契约流、前端 magic code 协议全部保留。
- 扩展项：对外暴露任务级黑盒 API（供本地 coding agent / MCP 调用），技能级接口按客户分级受控开放。

## 2. 设计原则

1. **能力收敛**：模型只能以声明式 tool call 表达意图（技能名 + 结构化参数）；argv、路径、cwd、超时、环境变量全部由运行时拼装。
2. **可见性与可执行性分离**：能力元数据（catalog + 技能手册）对 Master/Sub 全量可见；可执行工具按角色与契约注入。看得见才能规划与上报缺口，调不了才安全。
3. **进程即隔离**：按需拉起 worker 与技能进程，不做常驻。worker 崩溃只影响单会话，技能失败以 JSON 回给模型重试。
4. **契约不破坏**：python `argv[1]` JSON 进 / stdout JSON 出、gateway env / NDJSON 事件、PARAM_REQUEST / CHART_OPTION / WORKSPACE_SCHEMA / SKILL_FALLBACK 魔法码，全部原样保留。
5. **黑盒对外**：外部调用方只见任务与产物，不见提示词、技能手册与编排逻辑。

## 3. 总体架构

```text
Frontend ──► Gateway(复用) ──spawn──► worker 适配器(新)
                │                        │
                │                   AgentLoop(移植)
                │                        │ tool_calls
                │                   ToolRegistry(新) ◄── skills/registry.json
                │                        │ 校验后
                │                   SkillRunner(新) ──spawn──► python skills/*.py(复用)
                │                        │
                └── REST(复用) ──► MemoryStore(新) ⇄ data/users/.../.md(复用)

扩展项（阶段 5）：
本地 agent(Cursor 等) ──MCP──► 薄 MCP server ──token──► Gateway /api/tasks（任务级黑盒）
```

整条链上不存在：shell 工具、CLI TUI、apply_patch、sandbox、exec 白名单。

## 4. 核心模块设计

### 4.1 包结构

```text
agent-core/
├── package.json          # deps: openai, ajv, dotenv；无 ink/react/meow/chalk
└── src/
    ├── loop.ts           # 回合循环（从 agent-loop.ts 移植裁剪）
    ├── provider.ts       # OpenAI 兼容 chat.completions 流式封装
    ├── tool-registry.ts  # 知识层 + 执行层工具生成（安全边界 1）
    ├── skill-runner.ts   # 唯一 spawn 点（安全边界 2）
    ├── memory.ts         # 三层记忆注入与回写
    ├── worker.ts         # env/NDJSON 适配器（对 Gateway 无感替换）
    └── types.ts
```

### 4.2 loop.ts（移植，约 70% 复用）

保留自 `agent-loop.ts`：

- 流式增量聚合 `tool_calls`（name/arguments 分片拼接）
- 5xx / 超时 / 429 自动重试与退避
- `cancel()` / `terminate()`、`pendingAborts` 取消补偿（防 “No tool output found”）
- `sanitizeMessagesForApi` 等消息清洗（自 parsers.ts 部分移植）
- 多 JSON 拼接容错（extractFirstJsonObject 取第一个合法对象）

删除：

- `approvalPolicy` / `getCommandConfirmation`（无任意命令可确认）
- `handleExecCommand`、sandbox、apply_patch 分支

改写（原 `if (name === "shell")` 处）：

```ts
const tool = this.registry.get(name);
if (!tool) return toolError(callId, `Unknown tool '${name}'.`);
const args = validateWithSchema(tool.parameters, rawArguments); // ajv
if (!args.ok) return toolError(callId, `Invalid args: ${args.error}`);
const result = await tool.run(args.value, { signal, sessionDir });
return toolResult(callId, result);
```

本版维持一轮一个 tool call（与现有提示词、前端渲染兼容）；并行扇出留待后续版本。

### 4.3 tool-registry.ts（安全边界 1）

**知识层（全角色、只读）：**

- 启动时将全量技能清单（id / role / brief）静态注入 system prompt，Master 规划、Sub 缺口对照均无需额外调用。
- 内置工具 `get_skill_doc(skill_id)`：进程内读取 `skills/docs/*.md`，不限角色、不限 allowed_skills、无副作用。

**执行层（按角色注入）：**

```ts
function buildTools(mode: "master" | "sub", allowedSkills: string[]): Tool[] {
  const skills = loadRegistry().filter((s) =>
    s.enabled &&
    (mode === "master"
      ? s.role === "master"
      : s.role === "sub" && allowedSkills.includes(s.id)),
  );
  return [
    ...skills.map((s) => ({
      name: s.id,
      description: s.brief,
      parameters: s.input_schema,
      run: (args, ctx) => runSkill(s, args, ctx),
    })),
    getSkillDocTool(),
    memoryWriteTool(),
  ];
}
```

- Master 只注入 `role=master` 可执行工具；Sub 只注入 `allowed_skills ∩ role=sub`。
- 未授权技能在工具表中不存在，模型无法发起调用（从「事后拦截」变为「结构性不可达」）。
- Sub 发现目标需要不在 allowed_skills 内的技能时，沿用现有 `SKILL_FALLBACK` 魔法码上报缺口（catalog 可见性保证它说得出缺哪个技能）。

### 4.4 skill-runner.ts（安全边界 2，唯一 spawn 点）

```ts
async function runSkill(skill: RegistrySkill, args: object, ctx: RunContext) {
  const entry = path.resolve(SKILLS_ROOT, "..", skill.entry);
  if (!isInside(SKILLS_DIR, entry)) throw new Error("entry escapes skills dir");
  return spawnJson(PYTHON_BIN, [entry, JSON.stringify(args)], {
    cwd: ctx.sessionDir,                    // 固定，模型不可传
    env: pickEnv(skill.env),                // 按 registry env 字段白名单
    timeoutMs: skill.timeout_ms ?? 120_000, // 固定，模型不可传
    killProcessGroup: true,
  });
}
```

安全保证：

1. argv 全由运行时拼装：`PYTHON_BIN` 来自服务器环境，`entry` 只能来自 registry 且校验必须落在 skills 目录内；模型输入仅作为一个整体 JSON 字符串传入 `argv[1]`。
2. 不带 `shell: true`，不经 `/bin/sh` 解释，参数中的元字符（`;`、`&&`、反引号）无命令注入面。
3. 进入 spawn 前 args 已按 `input_schema` 校验。
4. Python 脚本零修改（argv[1] JSON 契约不变）。

### 4.5 memory.ts（记忆入环）

现状缺口：三层 memory 仅有 Gateway REST CRUD，从未进入模型上下文。V3 补齐：

- **回合开始注入**：读取 `user_memory.md` / `project_memory.md` / `session_memory.md`（沿用 `data/users/{uid}/projects/{pid}/sessions/{sid}/` 路径约定），每层截尾限长（默认 2KB），拼为 MEMORY 区块置于角色指令之前。
- **内置工具 `memory_write(scope, content)`**：scope 仅允许 `session` / `project`，追加写。`user_memory` 升级仍走人工 / Gateway REST，避免长期记忆污染（与 V2 运行规则一致）。
- **压缩**：会话结束或超阈值时由 gateway 触发 `memory/compress_memory.py`（现有脚本），后续可替换为 LLM 摘要，不阻塞 V3。

### 4.6 worker.ts（适配器，对 Gateway 无感）

env 契约（新增三项，其余沿用现有 `/api/chat` 注入）：

| 变量 | 状态 | 用途 |
| --- | --- | --- |
| WORKER_PROMPT / WORKER_CWD / WORKER_MODEL / WORKER_PROVIDER | 沿用 | 输入与模型 |
| WORKER_AGENT_MODE / WORKER_AGENT_SYSTEM_PROMPT | 沿用 | 角色与角色提示词 |
| WORKER_TASK_CONTRACT_FILE / WORKER_ALLOWED_SKILLS | 沿用 | 契约与执行范围 |
| WORKER_SKILLS_DIR / WORKER_PYTHON_BIN / WORKER_PROJECT_ROOT | 沿用 | 运行时路径 |
| **WORKER_USER_ID / WORKER_PROJECT_ID / WORKER_SESSION_ID** | 新增 | MemoryStore 定位三层记忆 |

stdout NDJSON 事件沿用：`{type: "item" | "loading" | "done" | "error"}`；历史读取沿用 `cwd/messages.json` 作为 prevItems。Gateway 的解析、落盘、超时兜底逻辑不改。

## 5. 安全模型

### 5.1 威胁对照

| 攻击面 | 现状（shell + exec 白名单） | V3 |
| --- | --- | --- |
| 任意命令（rm/curl/bash） | 模型可发出，事后拦截 | 工具表中不存在，发不出 |
| apply_patch 改文件 | 白名单显式豁免（漏洞） | 工具不存在 |
| 路径遍历执行脚本 | 多候选路径解析 | 只认 registry entry + 目录校验 |
| workdir / timeout 操纵 | 模型可传 | 参数不暴露 |
| 越权调用他角色技能 | exec-guard 拦截 | 工具不注入 + runner 复核 |
| LLM 生成代码落盘执行 | apply_patch 可写文件 | 无写文件工具；runner 不接受任意路径，链路在“写入”一步即断 |
| 技能进程内部能力（网络/文件） | 不受控 | 同样不受控 → 阶段 4 降权/容器兜底 |

### 5.2 完整性前提（服务器侧，须守住）

1. `skills/` 目录与 `registry.json` 对运行账号只读；能改这两样即等于拿到执行权。
2. **技能红线**：任何技能不得设计为「接收代码字符串并 eval/exec」。新增技能 review 必查。

### 5.3 运行模型：按需拉起（非常驻）

- 每次 `/api/chat` spawn 一个 worker，每个 tool call spawn 一次 python，跑完即退。唯一常驻件为 Gateway（职责薄：鉴权、SSE、文件）。
- 故障隔离：worker 崩溃只断单会话；技能失败以 JSON 回给模型自行重试；无跨会话状态积累与内存泄漏。
- 性能升级路径（仅在实测瓶颈后启用，按序渐进）：预热 worker 池 → 高频技能常驻小服务 + 连接池 → 全常驻（需补健康检查/实例隔离，非默认方向）。

## 6. 对现有系统的改动

| 对象 | 处置 | 说明 |
| --- | --- | --- |
| `skills/*.py` 全部脚本 | **原样复用** | argv[1] JSON 契约不变，0 修改 |
| `skills/registry.json` | 小改 | 补全所有 enabled 技能的 `input_schema` 与 `entry`；可选 `timeout_ms` |
| `gateway/server.js` | 小改 | `WORKER_PATH` → `agent-core/dist/worker.js`；env 增加三个 id |
| `agents/*/system.md` | 小改 | 删除 command 数组 / cat catalog 等 shell 话术；魔法码协议保留 |
| `agent-loop.ts` 循环逻辑 | 移植改造 | 拷入新包裁剪，分发层重写 |
| `parsers.ts` / `session.ts` | 部分移植 | 消息清洗保留；ExecInput 解析废弃 |
| 旧 `worker.ts` | 替换 | 新 worker 沿用 env/NDJSON 契约 |
| `handle-exec-command.ts` | 删除 | 职责由 ToolRegistry + SkillRunner 接管 |
| `cli.tsx` / Ink / apply_patch / sandbox | 移出部署面 | open-codex-source 不进服务器产物 |
| frontend `MessageRenderer` | 小改 | tool 块从 shell 命令改为技能名 + 参数展示 |
| `/api/generate-report` 独立链路 | 不变 | 服务器侧 spawn，本就不经模型；沿用 agentMode 校验 |

## 7. 扩展项：任务级 tools API（阶段 5）

### 7.1 商业定位

- **对外主产品 = 任务级黑盒**：输入 prompt + 参数，输出结果 + 产物；执行过程（提示词、技能手册、Master/Sub 编排）不可见。卖判断与交付物，按任务定价。
- **技能级接口受控开放**：仅「数据水龙头」型技能（如 `es_agg_search`）对分级客户开放，schema 给、手册不给（doc 替换为一页对外版）；规划类技能（`plan_charts` / `identify_report_type`）与 `get_skill_doc` 全量手册永不外放。
- 内部自用（自己的 Cursor 等）不受此限，可全量技能级接入。

### 7.2 接口设计

```text
POST /api/tasks              # 创建黑盒任务 {prompt, project_id, params}
GET  /api/tasks/:id          # 状态：planned/executing/validating/completed/failed（复用契约状态机）
GET  /api/tasks/:id/events   # SSE 进度（可选，仅阶段性事件，不含中间推理）
GET  /api/tasks/:id/artifacts/:name   # 产物下载
```

- **产物合同**：任务完成后输出结构化产物清单（报告 md/html、xlsx、chart JSON），本地 agent 拿产物用自己的 shell 继续加工——「shell 留在本地，云端只出料」。
- **MCP 薄封装**：独立薄进程，工具表两档——`run_cloud_task`（任务级，默认）+ 分级开放的少数数据技能（转发 `POST /api/skills/:id/run`，鉴权后直进 SkillRunner，跳过 LLM）。
- **鉴权与治理**：机器调用方使用每用户签发、可吊销的 API token（替代裸 userId 传参）；按 token 限流；调用审计日志落盘。
- 安全性质：调用方向为「本地调云端」，请求内容仅为 prompt 或 skill_id + 结构化参数，进入后过同一套 ToolRegistry / SkillRunner 边界；外部调用方权力 = 前端用户权力，无新增执行面。

## 8. 实施计划

| 阶段 | 内容 | 量级 | 验收标准 |
| --- | --- | --- | --- |
| 0 | registry 补全 input_schema；冻结 python argv 契约；skills 目录权限收紧 | 半天 | 所有 enabled 技能均有合法 schema |
| 1 | agent-core 四模块 + 新 worker；跑通 Master 规划链（identify_report_type → write_task_contract） | 2-3 天 | 规划任务端到端通过；模型无 shell 工具可见 |
| 2 | memory 注入 + memory_write；gateway 传三个 id env | 1-2 天 | 三层记忆出现在上下文；session/project 可回写 |
| 3 | gateway 切 WORKER_PATH；前端 tool 块展示；旧 worker 下线 | 1 天 | 全链路回归（Master 规划→确认→Sub 执行→验收）通过 |
| 4 | open-codex-source 移出部署产物；技能进程降权（专用账号 / 容器，限制出网） | 后续 | 部署面无 CLI/TUI/exec 代码；技能进程无越权文件访问 |
| 5（扩展） | 任务级黑盒 API + 产物合同 + MCP 薄封装 + token 鉴权/限流/审计 | 后续 | 本地 Cursor 经 MCP 完成一次黑盒任务并取回产物 |

## 9. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 工具形态 | per-skill tools（非单一 invoke_skill dispatcher） | schema 校验最严、提示词最省；代价是 registry 必须补全 schema |
| 可见性 | 元数据全量可见 + 执行按角色注入 | Master 需全量能力认知才能规划；Sub 需可见性产出高质量 SKILL_FALLBACK |
| tool call 节奏 | 一轮一个（串行） | 与现有提示词、前端渲染、契约流兼容；并行扇出留后 |
| 技术栈 | TypeScript（复用 agent-loop 基因） | 循环代码 70% 可移植；gateway spawn 模型不变 |
| 运行模型 | 按需拉起，非常驻 | 故障结构性隔离；任务形态为分钟级报告，spawn 开销可忽略 |
| 记忆写入 | 模型仅可写 session/project，user 层走人工 | 防长期记忆污染（承接 V2 运行规则） |
| 对外形态 | 任务级黑盒为主，技能级分级开闸 | 保护提示词/手册/编排三层资产；卖判断而非体力 |
