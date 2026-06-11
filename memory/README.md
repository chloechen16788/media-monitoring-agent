# Memory 分层说明

## 分层

- `user_memory`：用户长期偏好、硬约束、稳定背景。
- `project_memory`：项目级上下文、关键结论、可复用假设。
- `session_memory`：本次会话临时细节与中间推理痕迹。

## 写入策略

- 默认先写 `session_memory`。
- 仅将稳定事实提升到 `project_memory`。
- 仅将跨项目复用的稳定偏好提升到 `user_memory`。

## 压缩策略

- 会话结束或 token 超阈值时触发压缩。
- 使用 `compress_memory.py` 将冗长会话摘要为结构化要点。
