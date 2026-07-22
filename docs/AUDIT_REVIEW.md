# 项目初步代码审计报告

## 审计范围

- 项目目录：`gateway`、`frontend`、`skills`、`open-codex-source/codex-cli`
- 对照目标能力：
  - 基于 codex cli 内核开发
  - 多用户与会话历史隔离
  - 前端 RAG（embedding + rerank）联调
  - skills 调用能力
  - skills 渐进式加载与 schema 驱动报告
  - shell/脚本白名单执行限制

## 主要风险与问题（按严重度）

### 高危 1：会话隔离不完整（跨用户读写风险）

- `POST /api/chat` 已校验 `session_id + user_id` 归属，做法正确。
- 但以下接口仅按 `sessionId` 判断会话存在，未校验归属：
  - `GET /api/sessions/:sessionId/history`
  - `POST /api/sessions/:sessionId/upload`
  - `GET /api/sessions/:sessionId/download/:filename`
  - `POST /api/sessions/:sessionId/message`
- 风险：若拿到他人 `sessionId`，理论上可读取或注入他人会话数据。

### 高危 2：skills 运行路径硬编码（可用性与迁移性风险）

- 运行时实际使用 `gateway/server.js` 指向的 `dist/worker.js`。
- `dist/worker.js` 内含硬编码绝对路径（`/Users/Zhuanz/...`）：
  - skills 目录路径
  - `venv/bin/python` 路径
- 风险：在当前机器/新环境中，skills 可能直接不可执行。

### 高危 3：白名单策略匹配过宽（绕过风险）

- 当前逻辑基于 `command.join(" ").includes(...)` 判断安全命令。
- 仅检查是否“包含 `python` + `skills/`”等关键字，非结构化、非路径规范校验。
- 风险：可通过构造命令字符串绕过预期限制。

### 中高 4：上传目录与聊天工作目录不一致（附件可见性风险）

- 上传落地目录：`gateway/sessions/<sessionId>/workspace`
- worker 运行目录：`sessions/<sessionId>`
- 风险：前端“已上传”与模型“可访问附件”可能不一致，导致调用失败或行为不稳定。

### 中 5：前端 skills 列表硬编码（与 catalog 漂移风险）

- `frontend/src/components/ChatArea.tsx` 中 skills 清单为静态数组。
- 未直接读取 `skills/catalog.json`，与“统一目录 + 渐进加载”设计方向不一致。
- 风险：新增/下线 skills 时，前后端能力展示不一致。

## 模块主要功能清单

### gateway

- `server.js`
  - SQLite：用户与会话元数据
  - SSE：流式转发 worker 输出
  - 文件上传下载：基于 session workspace
  - 报告接口：调用 Python 编排脚本生成数据

### frontend

- `App.tsx`
  - 登录态、会话态、右侧面板状态管理
- `Sidebar.tsx`
  - 按用户拉取会话列表，创建新会话
- `ChatArea.tsx`
  - 聊天输入、SSE 消费、slash skills、附件上传
- `MessageRenderer.tsx`
  - markdown 渲染、工具调用块渲染、内嵌报告配置卡片
- `RightSidebar.tsx`
  - 动态 schema 报告画布 + ECharts 渲染 + 洞察投射

### skills

- `catalog.json`：skills 索引目录
- `get_skill_doc.py`：skills 说明读取入口
- `run_es_agent.py`：聚合与样本并发编排
- `rag_pipeline.py`：Chroma + embedding + rerank 检索管道
- `chart_render_schema.json` / `chart_sampling_schema.md` / `report_generation_schema.md`：图表与报告协议

### codex-cli 内核改造层

- `open-codex-source/codex-cli/dist/worker.js`
  - worker 主入口，注入企业指令并驱动 AgentLoop
  - shell 执行策略（含白名单拦截逻辑）

## 修复优先级建议

### P0（立即）

1. 为所有 `sessionId` 相关接口增加 `userId` 归属校验（与 `/api/chat` 对齐）。
2. 去除所有硬编码本机绝对路径，改为项目相对路径或环境变量配置。
3. 白名单升级为结构化命令校验：
   - 解析 argv，不依赖 `includes`
   - 校验脚本真实路径在允许目录内
   - 校验脚本文件存在且后缀合法

### P1（本周）

1. 统一上传路径与 worker 工作目录约定。
2. 前端 skills 列表改为后端/配置动态拉取，减少重复维护。
3. 为关键能力补自动化测试：
   - 会话越权访问测试
   - 白名单拦截绕过测试
   - skills 路径配置回归测试

## 结论

- 当前项目已具备目标功能雏形，特别是“多用户会话 + 前端报告 + skills + RAG”链路。
- 但存在若干上线前必须处理的安全与可靠性问题，建议先完成 P0，再继续扩展能力。

## P0 执行进展（2026-06-09）

### 已完成

1. 会话归属校验补齐（`gateway/server.js`）
   - 已对以下接口补充 `userId` 必传与 `session_id + user_id` 归属校验：
     - `GET /api/sessions/:sessionId/history`
     - `POST /api/sessions/:sessionId/upload`
     - `GET /api/sessions/:sessionId/download/:filename`
     - `POST /api/sessions/:sessionId/message`
   - 结果：修复“仅凭 sessionId 访问他人会话”风险点。

2. 前端请求联动 userId（`frontend/src/components/ChatArea.tsx`、`frontend/src/components/MessageRenderer.tsx`）
   - 历史读取、文件上传、下载链接、会话消息注入均已补齐 `userId`。
   - 结果：与后端新的会话归属校验对齐，避免功能回归。

3. worker 路径硬编码移除（`open-codex-source/codex-cli/src/worker.ts`）
   - 已移除固定本机路径（`/Users/Zhuanz/...`）。
   - 改为通过环境变量注入：
     - `WORKER_PROJECT_ROOT`
     - `WORKER_SKILLS_DIR`
     - `WORKER_PYTHON_BIN`
   - 结果：提升跨环境可迁移性。

4. 白名单升级为结构化校验（`open-codex-source/codex-cli/src/utils/agent/handle-exec-command.ts`）
   - 由字符串 `includes` 判断改为 argv + 路径规范化校验。
   - 当前仅允许：
     - `cat <skillsDir>/catalog.json`
     - `python <skillsDir>/*.py ...`（脚本必须位于 skills 目录且文件存在）
   - 结果：显著降低白名单绕过风险。

5. 运行时产物同步
   - 已重新构建 `open-codex-source/codex-cli`，确保 `dist/worker.js` 生效。
   - 已验证运行时不再包含旧硬编码路径关键字。

### 遗留与下一步

- P1 项尚未开始：
  - 上传目录与 worker 工作目录统一
  - skills 前端动态加载（替代硬编码列表）
  - 越权/白名单/路径配置回归测试

## V2 架构与计划落地（2026-06-09）

### 新增架构文件

- `ARCHITECTURE_V2.md`
  - 定义 Master/Sub 职责边界、实体模型、目录规范与运行规则。

- `DEVELOPMENT_PLAN_V2.md`
  - 定义 M1-M4 分阶段计划、验收标准、风险与缓解策略。

### 新增目录骨架与关键文件

- Agent 系统提示：
  - `agents/master/system.md`
  - `agents/sub/system.md`

- Skills 治理：
  - `skills/registry.json`（统一注册中心）
  - `skills/schemas/task_contract.json`（主子任务契约）
  - `skills/planner/.gitkeep`
  - `skills/executor/.gitkeep`

- Memory 能力：
  - `memory/README.md`
  - `memory/compress_memory.py`

- 运行时数据规范：
  - `data/README.md`
  - `data/users/.gitkeep`

### 计划映射（新架构已写入计划）

- M1（骨架搭建）已落地文档与目录基础设施。
- M2（后端 project/workspace/memory 流程改造）待开发。
- M3（前端 master/sub 协作可视化）待开发。
- M4（测试与迁移收口）待开发。

### 暂时搁置项（与计划关联）

- 已登记搁置问题：`ISSUE-20260609-01`（见 `ISSUE_BACKLOG.md`）
  - 问题：前端 Skills 点击触发 `textareaRef is not defined` 运行时异常。
  - 计划影响：
    - 不阻断 M2 后端改造推进；
    - 阻断 M3 前端技能入口和协作流完整联调，需先修复后恢复。

## M2 第二步执行进展（2026-06-09）

### 已完成

1. 后端基线收敛
   - 已移除 `gateway/server.js` 的临时调试埋点，保留 M2 业务逻辑。

2. project API 落地
   - 新增 `POST /api/projects`
   - 新增 `GET /api/projects?userId=...`
   - `GET /api/sessions?userId&projectId` 已纳入项目维度测试覆盖。

3. memory API（三层）落地
   - user memory：
     - `GET /api/memory/user`
     - `POST /api/memory/user`
   - project memory：
     - `GET /api/memory/project`
     - `POST /api/memory/project`
   - session memory：
     - `GET /api/memory/session`
     - `POST /api/memory/session`

4. 安全边界校验补齐
   - 新增 project 归属校验。
   - memory API 增加 user/project/session 组合校验。
   - header `x-user-id` 与目标 user 不一致时拒绝访问（403）。

5. 测试与验证
   - 新增测试：`gateway/tests/m2_step2.integration.test.mjs`
   - 回归命令通过：
     - `node --check server.js`
     - `node tests/m2_step1.integration.test.mjs`
     - `node tests/m2_step2.integration.test.mjs`

### 当前结论

- M2 主干后端能力已落地（project + workspace/session 路径 + 三层 memory）。
- 可进入 M3 前端协作流改造，但需先处理 `ISSUE-20260609-01` 以解除 UI 阻断。

## M3 第一轮执行进展（2026-06-09）

### 已完成

1. 前端阻断问题修复
   - `frontend/src/components/ChatArea.tsx` 已补齐 `textareaRef` 定义与 `textarea` 绑定，Skills 点击链路恢复。

2. 后端 M3 最小能力落地（`gateway/server.js`）
   - 新增 `GET /api/skills/registry`（支持 `role/enabled` 过滤）。
   - 新增项目级 task contract API：
     - `GET /api/projects/:projectId/task-contract`
     - `PUT /api/projects/:projectId/task-contract`
   - 新增项目级 agent state API：
     - `GET /api/projects/:projectId/agent-state`
     - `PUT /api/projects/:projectId/agent-state`
   - 新接口复用 `x-user-id` + project 归属校验，补齐跨用户/跨项目边界。

3. 运行时 Master/Sub 切换生效
   - `/api/chat` 已按项目 `agent_state` 解析当前模式，并选择：
     - `agents/master/system.md`
     - `agents/sub/system.md`
   - 注入 worker 环境变量：
     - `WORKER_AGENT_MODE`
     - `WORKER_AGENT_SYSTEM_PROMPT`
     - `WORKER_TASK_CONTRACT_FILE`
   - `open-codex-source/codex-cli/src/worker.ts` 已消费上述变量并拼接到运行时指令。

4. 前端 M3 第一轮联调
   - `Sidebar`：新增项目切换与按项目创建会话。
   - `ChatArea`：skills 改为 registry 动态拉取；新增 Master/Sub 切换与任务看板入口；chat/history/upload 已携带 `projectId`。
   - `RightSidebar`：新增 `tasks` 模式。
   - 新增 `frontend/src/components/TaskBoard.tsx`（任务闭环 MVP 可视化）。

5. 测试与构建验证
   - `open-codex-source/codex-cli` 构建通过：`npm run build`
   - `gateway` 回归通过：
     - `node --check server.js`
     - `node tests/m2_step1.integration.test.mjs`
     - `node tests/m2_step2.integration.test.mjs`
     - `node tests/m3_step1.integration.test.mjs`
   - `frontend` 构建通过：`npm run build`

### 当前结论

- M3 第一轮（含运行时切换）已打通主流程：模式切换、动态 skills、任务看板、后端状态与 worker 指令链路。
- M3 下一轮可继续实现 `agents/*/system.md` 在线编辑保存能力。

## M3 第二阶段执行进展（2026-06-09）

### 已完成

1. `system prompt` 后端读写 API 落地（`gateway/server.js`）
   - 新增：
     - `GET /api/agents/:role/system-prompt`
     - `PUT /api/agents/:role/system-prompt`
   - 约束：
     - `role` 仅允许 `master|sub`
     - `content` 必须为非空字符串
     - `x-user-id` 与目标 `userId` 不一致时拒绝访问（403）

2. 前端在线编辑器接入
   - 新增：
     - `frontend/src/components/AgentPromptEditor.tsx`
     - `frontend/src/components/AgentPromptEditor.module.css`
   - 集成：
     - `frontend/src/components/Sidebar.tsx` 底部新增 prompt 编辑区
   - 能力：切换 `master/sub`、读取当前 prompt、编辑并保存。

3. `next_chat` 自动生效链路
   - `/api/chat` 保持“每次请求实时读取 prompt 文件”的模式。
   - 新增响应头 `X-Agent-Prompt-Hash`，用于验证当前请求实际命中的 prompt 内容版本。

4. 测试与回归
   - 新增测试：`gateway/tests/m3_step2.integration.test.mjs`
   - 覆盖：
     - `GET/PUT system-prompt` 成功路径
     - 非法 `role`、空 `content` 参数校验
     - `x-user-id` 不匹配越权校验
     - 保存后下一次 `/api/chat` 命中新 prompt（通过 `X-Agent-Prompt-Hash` 校验）
   - 回归通过：
     - `node tests/m2_step1.integration.test.mjs`
     - `node tests/m2_step2.integration.test.mjs`
     - `node tests/m3_step1.integration.test.mjs`
     - `node tests/m3_step2.integration.test.mjs`
     - `npm run build`（frontend）

### 当前结论

- M3 第二阶段已完成，M3 计划项全部闭环（含 prompt 在线编辑与保存后下一次聊天生效）。
