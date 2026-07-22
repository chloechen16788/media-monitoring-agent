# 报告生成链路 Master/Sub 收敛改造计划

## 背景与根因

运行时执行拦截（`handle-exec-command.ts`）已生效：Master 在 worker 内已无法执行 executor 技能。
但用户仍观察到“Master 生成报告”，根因是**报告生成不走 worker**，而是独立链路：

1. Master 输出魔法码 `[WORKSPACE_SCHEMA_START]{schemaKey}[WORKSPACE_SCHEMA_END]`
2. 前端 `MessageRenderer.tsx` 渲染配置卡 → 用户点“生成”
3. 前端直接 `POST /api/generate-report` → 网关 `spawn run_es_agent.py`（**无任何 role/agentMode/owner 校验**）
4. 前端注入 `[系统通知] 已生成报告` 回对话

放大问题：
- `worker.ts` 给 master/sub 注入**相同**的 `DYNAMIC SKILL LIBRARY`（“先看 catalog、再执行技能”），与 `agents/master/system.md` “不执行 executor”矛盾。

## 权限边界（已与用户确认）

- **读取**：Master 拥有**全量 skills 读取权限**（catalog + registry + skill doc + schema）。
  目的：判断任务是否有对应技能、规划 Sub 该用哪些技能、识别报告类型与图表计划。
- **执行**：Master **只能执行 `role=master` 的技能**（如识别报告类型、规划图表）；
  executor / 未登记技能一律拒绝（exec-guard 已实现）。
- **Sub**：仅执行 `task_contract.allowed_skills` 内、`role=sub` 的技能。

## 目标态（已与用户确认）

- **Master = 规划（可读全量、只执行 master 技能）**：确认目标、**决定报告类型与图表计划**、写入 `task_contract`（goal / acceptance_criteria / allowed_skills），产出任务卡 → 委派 Sub。Master **不输出配置卡魔法码、不触发引擎**。
- **Sub = 配置 + 执行 + 洞察**：弹配置卡采集时间/任务 → 触发引擎 → 渲大屏 → 回写 `<UPDATE_INSIGHT>`。
- **回到 Master 验收**：比对验收项，置 `completed`/`failed`。

## 实施步骤

### 1) 网关：`/api/generate-report` 加 agentMode 硬校验（P0）
- 文件：`gateway/server.js`
- 入参补 `userId` / `projectId` / `agentMode`；读取项目 `agent_state.active_agent`。
- `active_agent === 'master'`（或显式 master）→ 返回 `403 { error: 'policy_violation', reason: 'report engine is sub-only' }`。
- 仅 sub 放行。成功后更新 `task_contract`：写 `executor_result`，状态 `executing -> validating`。

### 2) Worker 指令按角色拆分（P0）
- 文件：`open-codex-source/codex-cli/src/worker.ts`
- **master 分支**：可**全量读取** catalog/registry/skill doc/schema 用于规划；但只执行 `role=master` 技能，禁止执行 executor、禁止输出 `[WORKSPACE_SCHEMA_START]`。产出“技能匹配判断 + 报告类型 + 图表计划 + task_contract + 验收项”，然后委派 Sub。移除“看到技能就直接执行”的诱导，强调“可读全量、仅规划、执行交给 Sub”。
- **sub 分支**：保留 `DYNAMIC SKILL LIBRARY`（探索/执行 allowed_skills），并明确配置卡魔法码、引擎、洞察归 sub。

### 3) Master 读取权限保持全量（P1）
- Master **保留全量 catalog/registry 读取**（不隐藏 executor / generate_report），用于规划与技能匹配判断。
- exec-guard 维持现状：master 只放行 `get_skill_doc.py` 与 `role=master` 技能，executor/未登记技能拒绝。

### 3.5) 落地真实 master 技能（已确认）
- 新增脚本：
  - `skills/planner/identify_report_type.py`：输入用户意图文本，输出报告类型（`brand_monthly` / `competitor_weekly`）及理由。
  - `skills/planner/plan_charts.py`：输入报告类型，基于 schema 输出建议图表计划与对应 `allowed_skills`。
- 注册：在 `skills/registry.json` 将二者设为 `role: master`、`enabled: true`，`entry` 指向上述路径。
- 可见性：在 `skills/catalog.json` 增加 id + brief，使 master 读目录即可发现。
- 文档：在 `skills/get_skill_doc.py` 的 `DOCS` 增加二者的调用说明（参数/返回）。
- 校验：exec-guard 通过 registry `role=master` 放行（脚本在 skills 目录内、`.py` 结尾，按 entry 路径匹配）。

### 4) 前端：报告类型=Master 规划，配置卡仅 Sub（P1）
- 文件：`frontend/src/components/MessageRenderer.tsx`、`ChatArea.tsx`
- 配置卡“生成”按钮仅在 sub 模式可用；master 模式隐藏/禁用。
- 前端调 `/api/generate-report` 时带 `userId/projectId/agentMode`。
- Sub 配置卡的 schema 从 `task_contract`（Master 写入的报告类型）读取。

### 5) 契约状态机贯通（P0）
- generate-report 成功 → 写 `executor_result` 并 `executing -> validating`。
- Master 验收回合置 `completed`/`failed`。

### 6) 测试与回归（P0）
- 新增 `gateway/tests/m3_report_policy.integration.test.mjs`：
  - master 态 POST `/api/generate-report` → 403；
  - sub 态 → 放行（或进入执行）。
- 回归：`m3_policy_guard`、`m3_contract_flow`、`m3_step1`、`m3_step2`、`m2_step1`、`m2_step2` 全通过。

## 验收标准
- Master 任何情况下都不能触发报告引擎，也不再输出配置卡。
- 报告生成完整经历：Master 规划(定类型) → 委派 → Sub 配置+执行+洞察 → Master 验收。
- `/api/generate-report` 对 master 返回明确策略拒绝。
- 相关集成测试通过，不回归现有 M2/M3 功能。
