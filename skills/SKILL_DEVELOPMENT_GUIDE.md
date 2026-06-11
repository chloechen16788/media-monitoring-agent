# Agent Skills 统一规范 V2（创建 / 注册 / 调用全流程）

> 本文档是 skills 的唯一权威规范（SSOT 文档）。任何模型或开发者新增、修改技能，必须严格按本文执行，禁止自创异构模式。
> 本规范与运行时强制策略（企业沙箱白名单、registry 角色管控）一一对应：**凡是本文档没有允许的写法，沙箱都会拦截。**

---

## 0. 一页速查（写技能前先读这里）

1. 技能只有两类：**A 类 = 可执行 Python 脚本**（`type: "script"`），**B 类 = 编排说明文档**（`type: "doc"`，Markdown）。禁止"只为 print 提示词而存在"的 py 脚本。
2. **注册只手改一个文件**：`skills/registry.json`（唯一事实源）。其余均为派生物：
   - A 类技能另写一份说明书 `skills/docs/<skill_id>.md`（get_skill_doc 自动拼接输出）
   - `catalog.json` 由 `python skills/sync_catalog.py` 自动生成，**禁止手改**
   - `get_skill_doc.py` 无需改动（registry 驱动，无内置数据）
3. A 类技能入参统一为**单个 JSON 字符串作为 argv[1]**；输出统一为**单个 JSON 对象**（含 `ok` 字段）。
4. 密钥、服务地址、账号一律走**环境变量**，脚本内禁止硬编码、禁止写默认兜底值。
5. 沙箱只放行三种命令形态（见第 5 节）。B 类文档中出现的每一条示例命令，都必须是这三种形态之一。
6. **技能之间永不互相调用**：多技能串联（取数依赖、抽样联动等）一律按第 4.1 节执行——模型编排、B 类文档当剧本、结构化错误指回上游。
7. 写完后必须跑完第 8 节的自检清单。

---

## 新增 Skill 最短流程（4 步）

1. 新建脚本（或文档）文件。
2. 只改 `skills/registry.json` 增加条目。
3. 若是 A 类脚本，再加 `skills/docs/<skill_id>.md`。
4. 执行：
   - `python skills/sync_catalog.py`
   - `cd gateway && node tests/skills_spec.test.mjs`

只要第 4 步通过，三个文件不同步的问题就会被自动拦住。

---

## 1. 术语与角色

| 术语 | 含义 |
|---|---|
| Master | 规划/验收 agent，只能执行 `role: "master"` 的技能 |
| Sub | 执行 agent，只能执行 `role: "sub"` 且在 `task_contract.allowed_skills` 中的技能 |
| 渐进式披露 | 模型分三层获取技能信息：catalog（一句话）→ get_skill_doc（说明书）→ 执行脚本/文档 |
| 沙箱白名单 | `handle-exec-command.ts` 中的强制策略，拦截一切非许可命令 |

## 2. 目录结构规范

```text
skills/
├── SKILL_DEVELOPMENT_GUIDE.md   # 本规范
├── registry.json                # 唯一注册中心（SSOT，注册时唯一需要手改的文件）
├── catalog.json                 # 生成物：由 sync_catalog.py 从 registry 生成，禁止手改
├── sync_catalog.py              # catalog 生成器（python skills/sync_catalog.py）
├── get_skill_doc.py             # 说明书统一入口（registry 驱动，无内置数据，一般无需改动）
├── planner/                     # role=master 的规划类脚本
│   └── <skill_id>.py
├── executor/                    # role=sub 的执行类脚本（新技能必须放这里）
│   └── <skill_id>.py
├── docs/                        # 技能说明书与 B 类编排文档
│   ├── <skill_id>.md            # A 类技能的详细说明书（功能/调用方式/参数/返回格式）
│   └── <skill_id>_schema.md     # B 类编排文档
└── schemas/                     # 协议类 JSON Schema（如 task_contract.json）
```

约束：

- 新增 A 类脚本：master 角色放 `planner/`，sub 角色放 `executor/`。**禁止再往 `skills/` 根目录新增脚本**（根目录现存脚本为遗留，见第 9 节）。
- 文件名必须等于 `skill_id`（如 `skill_id: "send_email"` → `executor/send_email.py`）。
- `skill_id` 命名：全小写下划线，动宾结构（`verb_object`），如 `es_agg_search`、`plan_charts`。
- 禁止把 `__pycache__`、测试数据、临时文件放入 skills 目录。

### 2.1 分类判定规则（新技能放哪个目录？）

按顺序回答三个问题，落点唯一：

```text
Q1: 它是可执行脚本，还是给模型看的文字？
    ├─ 文字（SOP/协议/编排剧本）────────────→ docs/<skill_id>_schema.md（B 类，type=doc）
    ├─ 跨技能共享的纯 JSON Schema 协议 ─────→ schemas/（不注册为技能，经 get_skill_doc 路由暴露）
    └─ 可执行脚本 → Q2

Q2: 它服务于「定计划」还是「干活」？
    ├─ 产出/校验计划与契约本身（识别意图、规划图表、写契约）
    │      = 只有 Master 在规划阶段需要 ───→ planner/（role=master）
    └─ 对外部世界或数据做实际操作 → Q3

Q3: 干活类一律放 executor/（role=sub），不论动作类型：
    ├─ 取数（es_agg_search, es_sample_search）
    ├─ 纯计算/变换/渲染（render_line_chart：不取数、不发请求，也算"干活"）
    ├─ 对外动作（发消息、发邮件、抓网页）
    └─ 检索增强（rag_pipeline, web_search）
```

判定口诀：**“这个脚本的输出是『计划/契约』还是『结果/产物』？”** 前者 planner，后者 executor。容易误判的两类：

- **纯计算技能（如图表渲染）**：虽然不碰外部系统，但它产出的是任务结果的一部分（图表配置），由 Sub 在执行阶段调用 → `executor/`。
- **“给模型的指引”想写成 py**：禁止。只为 print 提示词而存在的脚本一律改写为 B 类文档（第 0 节第 1 条）。

现存技能落点对照（与 registry 一致）：

| 目录 | 技能 | 判定依据 |
|---|---|---|
| `planner/` | `identify_report_type`、`plan_charts`、`write_task_contract` | 输出是计划/契约，仅 Master 规划阶段使用 |
| `executor/` | `render_line_chart` | 输出是任务产物（图表配置），Sub 执行阶段调用 |
| `docs/` | `line_chart_analysis_schema` 等 | 编排剧本，给模型看的文字 |
| 根目录（遗留） | `es_agg_search`、`es_sample_search` 等 | 判定上属于 executor，待按第 9 节迁移 |

## 3. A 类技能（可执行 Python 脚本）开发规范

### 3.1 入参约定（强制统一）

唯一合法形态：**argv[1] 传入单个 JSON 字符串**。

```bash
python skills/executor/<skill_id>.py "{\"key\": \"value\"}"
```

- 禁止 argparse 多 flag 风格（`--target xxx --message yyy`）。
- 禁止从 stdin 读取（沙箱无法通过 shell 数组传 stdin）。
- 禁止多个位置参数。
- 参数为空可接受 argv 缺省，但脚本必须返回结构化错误而不是 usage 文本。

脚本头部标准解析模板：

```python
import sys, json

def read_params() -> dict:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        return json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return {"__parse_error__": raw}
```

### 3.2 输出契约（强制统一）

stdout 只允许输出**一个 JSON 对象**，结构如下：

```json
{"ok": true,  "data": { ... }}
{"ok": false, "error": "缺少必要参数: task_ids", "hint": "请检查 task_contract.input_context"}
```

- 禁止 emoji、装饰性文本、进度打印。
- 禁止在输出中夹带提示词/指令文本（如"请务必根据以上结果回答"）——给模型的行为指令只能写在 B 类文档或 system prompt 中。
- 失败时 `ok: false` + `error`，退出码可为 0（由模型读 JSON 判断），但不得抛裸异常堆栈到 stdout。
- `print(json.dumps(result, ensure_ascii=False))` 是唯一的输出语句。

### 3.3 配置与密钥（强制）

- API key、服务地址、账号 ID 等一律 `os.environ` 读取，**禁止硬编码、禁止默认兜底值**。
- 缺失环境变量时返回 `{"ok": false, "error": "missing env: XXX"}`。
- 环境变量命名：`SKILL_<用途>`，如 `SKILL_FIRECRAWL_API_KEY`、`SKILL_ES_URL`。
- 新增环境变量必须登记到 registry 条目的 `env` 字段（见 4.1），并在 gateway 启动配置中注入。

### 3.4 设计哲学：Fat Model, Thin Tools

- 工具只做纯粹的 I/O：查询、发送、抓取、计算。
- **禁止**在脚本里硬编码业务映射（如"品牌名→task_id"的对照表）、流程编排、意图判断。这些属于模型（配合 B 类文档）的职责。

## 4. B 类技能（编排说明文档 Markdown）开发规范

适用：业务流 SOP、Generative UI 触发协议、复杂抽样/报告逻辑指导。

- 文件放 `skills/docs/<skill_id>_schema.md`。
- 文档中出现的**每一条示例命令**必须是第 5 节允许的三种形态之一。特别注意：
  - **禁止**指导模型使用 `bash for` 循环、管道、`&&` 串联——需要多次调用时，写明"逐次发起多个独立的 python 命令"。
  - **禁止**指导模型 `cat` 除 `catalog.json` 以外的文件——若模型需要读取某 JSON/MD 资源，必须通过 `get_skill_doc.py` 路由暴露该资源。
- 文档必须写清四件事：何时触发、需要向用户确认什么、输出什么特殊标记（如 `[WORKSPACE_SCHEMA_START]`、`<UPDATE_INSIGHT>`）、与哪些 A 类技能串联。
- 涉及 Master/Sub 分工的，必须显式声明哪个角色执行哪一步（如"魔法码仅由 Sub 输出"）。

### 4.0 魔法码清单（角色归属强制）

| 魔法码 | 允许角色 | 用途 | 载荷要求 |
|---|---|---|---|
| `[PARAM_REQUEST_START]... [PARAM_REQUEST_END]` | Master | 请求用户补齐执行参数，前端渲染输入 chips（文本/选择/日期） | 必须是 JSON 对象，至少含 `fields` 数组；每项含 `key/label/type`，可选 `required/pattern/hint/options` |
| `[WORKSPACE_SCHEMA_START]... [WORKSPACE_SCHEMA_END]` | Sub | 触发整份报告大屏配置卡 | 必须是 JSON 对象，且包含 `schemaKey` |
| `[CHART_OPTION_START]... [CHART_OPTION_END]` | Sub | 在聊天区内渲染单图（ECharts） | 块内必须是合法图表 JSON（通常直接复制技能返回的 `chart_block`） |
| `<UPDATE_INSIGHT target=\"...\">...</UPDATE_INSIGHT>` | Sub | 将洞察投射到右侧大屏插槽 | 必须包含 `target`，内容为可读洞察文本 |

约束：
- `PARAM_REQUEST` 是 **Master 专属**；Sub 禁止输出。
- `WORKSPACE_SCHEMA` / `CHART_OPTION` / `UPDATE_INSIGHT` 是 **Sub 专属**；Master 禁止输出。
- 角色不匹配会导致前端误触发或无效触发，视为违规输出。

### 4.1 技能关联规范（强制，所有涉及多技能串联的场景一律按此执行）

核心原则：**技能之间永不互相调用，串联由模型完成，B 类文档是串联的"剧本"**。
（依据：Fat Model, Thin Tools——脚本互调会把业务流硬编码进工具；且子进程串联无法被沙箱白名单逐条审计。）

1. **禁止脚本互调**：A 类脚本内禁止 `import` 另一个技能脚本、禁止 `subprocess` 调用其他技能。每个脚本都是独立的纯工具。
2. **串联剧本写在 B 类文档**：凡是"先取数 → 再加工 → 再抽样"这类多技能流程，必须新建（或扩展）一份 B 类编排文档，按步骤写明每一步调用哪个技能、入参怎么构造。每一步都是一条独立的白名单命令（`python skills/....py "<JSON>"`）。
3. **取数依赖用"结构化错误 + hint 指回剧本"表达**：下游脚本发现数据缺失/不齐时，不得自行取数，必须返回
   `{"ok": false, "error": "...", "hint": "请按 <B类文档id> 说明书先调用 <上游技能> ..."}`，由模型回到 SOP 补取数。
4. **数据在技能间传递靠模型变换**：上游输出 → 模型整理映射 → 下游入参。脚本不感知彼此的输出格式；需要驱动后续调用的关键中间结果（如折线图的 Top3 峰值日期），上游必须作为**结构化字段**显式返回（如 `data.peaks`），不能要求模型从图表/文本里自行目测。
5. **契约声明完整链路**：Master 规划时，`task_contract.allowed_skills` 必须一次性包含该流程用到的**全部**可执行技能（如 `["es_agg_search", "es_sample_search", "render_line_chart"]`），缺一则 Sub 执行到一半被沙箱拦截。B 类文档开头必须列出本流程所需的 allowed_skills 清单。
6. **多次调用 = 多条独立命令**：需要对 N 个对象（峰值日期、媒体、实体等）分别抽样时，发 N 条独立 python 命令，禁止循环/管道/串联。
7. **失败如实上报**：链路中任一环节失败或无数据，按原样返回结构化错误并说明，禁止编造数据补齐流程。

参考实现：`docs/line_chart_analysis_schema.md`（取数 → 渲染 → 峰值抽样归因的完整串联示例）。

## 5. 沙箱允许的命令形态（运行时强制，超出即拦截）

| # | 形态 | 用途 |
|---|---|---|
| 1 | `["cat", "<skillsDir>/catalog.json"]` | 第一层披露：浏览技能目录 |
| 2 | `["python", "<skillsDir>/get_skill_doc.py", "<skill_id>"]` | 第二层披露：读说明书（master/sub 均放行） |
| 3 | `["python", "<skillsDir>/.../<skill_id>.py", "<json>"]` | 第三层：执行技能（受角色与 allowed_skills 管控） |

角色管控规则（与 registry 联动）：

- Master：仅可执行 registry 中 `role: "master"` 的脚本；未注册脚本一律拦截。
- Sub：仅可执行 registry 中 `role: "sub"` **且** id 在 `task_contract.allowed_skills` 内的脚本。
- 任何 `bash -c`、循环、管道、重定向、`rm/curl` 等系统命令一律拦截。
- 命令必须是 JSON 字符串数组，不能是单一字符串。

## 6. 注册全流程（手改一处 + 写一份说明书 + 跑一条命令）

### Step 1：登记 `registry.json`（唯一需要手改的注册文件）

```json
{
  "id": "send_email",
  "type": "script",
  "role": "sub",
  "group": "executor",
  "entry": "skills/executor/send_email.py",
  "enabled": true,
  "brief": "向指定收件人发送一封邮件。",
  "env": ["SKILL_SMTP_HOST"],
  "input_schema": {
    "type": "object",
    "required": ["to", "subject", "body"],
    "properties": {
      "to": {"type": "string"},
      "subject": {"type": "string"},
      "body": {"type": "string"}
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["ok"],
    "properties": {"ok": {"type": "boolean"}, "data": {"type": "object"}, "error": {"type": "string"}}
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一 ID，等于脚本/文档文件名 |
| `type` | ✅ | `script`（A 类）或 `doc`（B 类） |
| `role` | A 类必填 | `master` / `sub`，决定哪个 agent 可执行 |
| `group` | ✅ | `planner` / `executor` / `doc` |
| `entry` | A 类必填 | 相对项目根的脚本路径；B 类填 md 路径 |
| `enabled` | ✅ | 下线技能改 `false`，不删除条目 |
| `brief` | ✅ | 一句话描述，与 catalog 保持逐字一致 |
| `env` | 用到则必填 | 依赖的环境变量清单 |
| `input_schema` / `output_schema` | A 类必填 | JSON Schema，参数契约 |

- brief 命名约定：Master 专用技能以 `【Master 规划】` 开头；B 类文档型以 `【说明书】` 开头。

### Step 2：编写说明书 `skills/docs/<skill_id>.md`（仅 A 类需要）

文件名必须等于 skill_id。内容包含四段（名称/角色/路径由 get_skill_doc 从 registry 自动拼接，**不要**在 md 里重复写）：

```text
【功能】: 向指定收件人发送一封邮件。
【调用方式】: python skills/executor/send_email.py "{\"to\": \"...\", \"subject\": \"...\", \"body\": \"...\"}"
【参数说明】:
  - to (必需): 收件人地址
  - subject (必需): 邮件标题
  - body (必需): 邮件正文
【返回格式】: JSON {"ok", "data"|"error"}
```

B 类技能不需要此文件：`get_skill_doc.py <id>` 会直接输出 registry `entry` 指向的文档全文。

### Step 3：生成 catalog 并验证

```bash
python skills/sync_catalog.py        # 从 registry 重新生成 catalog.json
cd gateway && node tests/skills_spec.test.mjs   # 一致性测试必须通过
```

- `catalog.json` 是生成物，**任何情况下禁止手工编辑**；忘记执行 sync 会被一致性测试拦下。
- `get_skill_doc.py` 无需改动：它从 registry 读取技能列表，catalog 中每个 id 天然可查说明书。

## 7. 调用全流程（模型视角）

### Master（规划阶段）

1. `cat catalog.json` 浏览全部技能 brief。
2. 对候选技能逐个 `python get_skill_doc.py <id>` 读说明书。
3. 仅执行 `role: "master"` 的规划技能（如 `identify_report_type` → `plan_charts`）。
4. 产出 `task_contract`：`goal` + `acceptance_criteria` + `allowed_skills`。
   - `allowed_skills` 只能填 registry 中 `role: "sub"` 的可执行技能 id。
   - 需要 Sub 阅读的 B 类文档，写入 `input_context.reference_docs`（数组），**不要**混入 `allowed_skills`。
5. 不输出 Generative UI 魔法码，不执行 executor 技能，告知用户交接 Sub。

### Sub（执行阶段）

1. 读取 `task_contract.json`，确认 `goal` / `allowed_skills` / `output_schema`。
2. 对每个待用技能先 `python get_skill_doc.py <id>`，再按说明书构造**单条 JSON 入参**执行。
3. 需要多次抽样/查询时，**逐次发起多条独立 python 命令**（禁止 shell 循环）。
4. 结果按 contract 的 `output_schema` 输出结构化 JSON；报告类任务由 Sub 输出魔法码与 `<UPDATE_INSIGHT>`。
5. 缺参/失败时返回结构化错误，不擅自改计划、不编造数据。

## 8. 新技能上线自检清单（必须全过）

```text
[ ] 文件位置按 2.1 判定规则落位（planner/ 或 executor/ 或 docs/），文件名 == skill_id
[ ] registry.json 已登记，字段齐全（type/role/group/entry/enabled/brief/input_schema/output_schema）
[ ] A 类已编写 skills/docs/<skill_id>.md（功能/调用方式/参数说明/返回格式四段）
[ ] 已执行 python skills/sync_catalog.py 重新生成 catalog.json（禁止手改 catalog）
[ ] python skills/get_skill_doc.py <skill_id> 能返回完整说明书
[ ] 说明书中的调用示例可被沙箱放行（第 5 节三种形态之一）
[ ] 脚本入参为单 JSON argv；空参/错参返回 {"ok": false, "error": ...}
[ ] stdout 仅一个 JSON 对象，无 emoji/装饰文本/提示词注入
[ ] 无硬编码密钥/地址/账号；依赖的环境变量已写入 registry.env
[ ] 手工冒烟：python <entry> "<合法JSON>" 返回 {"ok": true, ...}
[ ] B 类文档：每条示例命令逐条对照第 5 节核验
[ ] node gateway/tests/skills_spec.test.mjs 通过
```

## 9. 遗留技能豁免说明（仅适用于存量，禁止仿照）

以下存量实现**不符合本规范**，新技能禁止模仿，待迁移时逐个修复：

| 遗留项 | 问题 | 迁移方向 |
|---|---|---|
| `skills/` 根目录下的 executor 脚本 | 未入 `executor/` | 迁目录 + 改 registry.entry |
| `send_feishu_message` / `check_reimbursement_progress` | argparse 多 flag 入参 | 改单 JSON argv |
| `run_es_agent` | stdin 读参（沙箱不可调用） | 改单 JSON argv，或仅保留给 gateway 内部调用并从 registry 移除 |
| `web_search` / `deep_web_crawl` | 硬编码 API key；get_skill_doc 缺说明书 | key 走环境变量；补 DOCS |
| `es_agg_search` | 硬编码 ES 地址与 uid/partition 默认值 | 走环境变量，去默认值 |
| `query_reimbursement_policy` | 输出夹带提示词 | 指令移入 B 类文档 |
| `chart_sampling_schema.md` | 指导使用 bash for 循环（必被拦截） | 改为"逐次多条 python 命令" |
| `report_generation_schema.md` | 指导 cat chart_render_schema.json（必被拦截） | 经 get_skill_doc 路由暴露 |
| `catalog.json` 与 `registry.json` 漂移 | 双向缺项 | 以 registry 为准补齐双向 |
