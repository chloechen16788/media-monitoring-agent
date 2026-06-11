# Codex + Skills V2 架构落地说明

## 目标

- 建立 Master/Sub 串行协作的双 Agent 架构。
- 规范 skills 分层，减少目录混乱。
- 引入 user/project/session 三层 memory 与 project workspace。
- 形成可审计、可回放的任务执行闭环。

## 核心实体

- `user`：租户边界，隔离 memory 和用户自定义 skills。
- `project`：工作主题边界，隔离 workspace 与 project memory。
- `session`：对话线程边界，记录本轮消息与临时记忆。
- `task`：Master 下发给 Sub 的可执行任务单元（JSON 契约）。

## Agent 职责

- `master-agent`
  - 规划、分配、验收、重试决策。
  - 可读取所有 skills 元数据。
  - 不直接执行 executor skills。
- `sub-agent`
  - 只执行任务契约中的技能调用。
  - 输出结构化 JSON 结果。
  - 不修改总体计划。

## 目录结构（V2）

```text
codex-agent/
├── ARCHITECTURE_V2.md
├── DEVELOPMENT_PLAN_V2.md
├── agents/
│   ├── master/system.md
│   └── sub/system.md
├── skills/
│   ├── registry.json
│   ├── get_skill_doc.py
│   └── schemas/
│       └── task_contract.json
├── memory/
│   ├── README.md
│   └── compress_memory.py
├── data/
│   └── users/{userId}/projects/{projectId}/sessions/{sessionId}/...
├── gateway/
├── frontend/
└── open-codex-source/
```

## 关键文件用途

- `agents/master/system.md`：Master 系统提示词，定义“只规划与验收”规则。
- `agents/sub/system.md`：Sub 系统提示词，定义“只执行与返回 JSON”规则。
- `skills/registry.json`：skills 注册中心（分组、角色、schema、权限）。
- `skills/schemas/task_contract.json`：主子代理任务交接契约。
- `memory/compress_memory.py`：将长会话记忆压缩写入 project memory。
- `data/users/...`：运行时持久化目录，存放用户记忆、项目产物、会话记录。

## 运行规则（建议）

1. 同一时刻仅运行一个 Agent（Master 或 Sub）。
2. Sub 仅接收 `task_contract.json` 指令，不接受自由文本任务。
3. 所有结果必须先过结构化校验，再进入 Master 验收。
4. 仅将“稳定偏好/硬约束”写入 `user_memory`，避免长期记忆污染。
