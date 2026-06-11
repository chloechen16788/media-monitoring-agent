# V2 优化开发计划

## 阶段目标

- `M1`：先完成目录、契约、角色边界（低风险快速落地）。
- `M2`：完成 gateway 的 project/workspace/memory 主流程改造。
- `M3`：完成前端 Master/Sub 交互与任务闭环可视化。
- `M4`：完成回归测试与迁移收口。

## M1：架构骨架（1-2 天）

- [x] 新增 `agents/master/system.md` 与 `agents/sub/system.md`。
- [x] 新增 `skills/registry.json`。
- [x] 新增 `skills/schemas/task_contract.json`。
- [x] 新增 `memory/compress_memory.py` 与 `memory/README.md`。
- [x] 建立 `data/users/...` 运行时目录规范（先以占位文件落地）。
- [ ] 更新 `get_skill_doc.py` 支持基于 `registry.json` 查询。

验收标准：
- 目录与关键文件可被读取。
- registry 可表达角色与 schema 信息。

## M2：后端流程改造（2-4 天）

- [x] gateway 新增 `project` 概念与关联 API。
- [x] 会话从 `sessions/<sessionId>` 迁移到 `data/users/<uid>/projects/<pid>/sessions/<sid>`。
- [x] 上传路径改为 project/session 一致路径。
- [x] 任务执行前写入 `task_contract.json`，Sub 仅按契约执行。
- [x] 增加 memory 写入 API（user/project/session 三层）。

验收标准：
- 同用户多项目间数据不串。
- 同项目多会话可共享 project memory。
- 旧 API 兼容或有迁移指引。

M2 执行状态（2026-06-09）：
- Step1 与 Step2 集成测试均通过：
  - `node tests/m2_step1.integration.test.mjs`
  - `node tests/m2_step2.integration.test.mjs`

## M3：前端与协作流（2-3 天）

- 依赖说明：`ISSUE-20260609-01` 已在 M3 第一轮中修复，已解除 UI 阻断。
- [x] 增加 Master/Sub 模式切换与当前模式状态展示。
- [x] 新增任务看板（计划、执行中、验收中、完成/失败）。
- [x] skills 列表改为从后端 registry 动态拉取。
- [x] 支持编辑并保存 `agents/*/system.md`。

验收标准：
- 用户可看见完整任务闭环状态。
- skills 展示与后端 registry 一致。

M3 第一轮执行状态（2026-06-09）：
- 前端阻断修复：`ChatArea.tsx` 已补齐 `textareaRef` 定义与绑定。
- 后端新增 API：
  - `GET /api/skills/registry`
  - `GET/PUT /api/projects/:projectId/task-contract`
  - `GET/PUT /api/projects/:projectId/agent-state`
- 运行时切换已接入：
  - `/api/chat` 会按 `agent_state` 选择 `agents/master/system.md` 或 `agents/sub/system.md`
  - 已将 `agentMode` 与角色 prompt 通过 env 注入 worker
- 前端已接入：
  - 项目切换、动态 skills、Master/Sub 切换、任务看板 MVP
- 新增集成测试：
  - `node tests/m3_step1.integration.test.mjs`

M3 第二阶段执行状态（2026-06-09）：
- 新增后端 API：
  - `GET /api/agents/:role/system-prompt`
  - `PUT /api/agents/:role/system-prompt`
- 参数与安全校验：
  - `role` 仅允许 `master|sub`
  - `content` 必须为非空字符串
  - `x-user-id` 与目标 `userId` 不一致时返回 403
- 前端已接入在线编辑器：
  - 新增 `frontend/src/components/AgentPromptEditor.tsx`
  - 已集成到 `Sidebar` 底部设置区，可切换 `master/sub` 读取并保存 prompt
- `next_chat` 生效机制：
  - `/api/chat` 每次请求实时读取 prompt 文件
  - 新增响应头 `X-Agent-Prompt-Hash` 用于链路验证
- 新增测试：
  - `node tests/m3_step2.integration.test.mjs`
- 验收备注：
  - 已登记 `ISSUE-20260609-02`：本地手工验收可能命中旧网关进程导致 `system-prompt` 路由 404，需先收敛运行中的 dev 进程再做联调取证。

## M4：稳定性与回归（1-2 天）

- [ ] 增加越权访问测试（用户/项目/session 维度）。
- [ ] 增加白名单绕过测试与路径边界测试。
- [ ] 增加 memory 压缩结果测试。
- [ ] 输出迁移说明（旧目录到新目录）。

验收标准：
- 核心回归测试通过。
- 关键日志可追溯（task_id、project_id、session_id）。

## 风险与缓解

- 风险：一次性迁移目录导致兼容问题。  
  缓解：先双写（旧路径 + 新路径），稳定后切换读路径。

- 风险：memory 过快膨胀。  
  缓解：压缩策略 + 写入门槛（仅稳定事实落 user memory）。

- 风险：Master/Sub 边界被提示词绕过。  
  缓解：在白名单与 registry 层做角色校验，不仅依赖 system prompt。
