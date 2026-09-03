【功能】: 扫描最近 N 小时（默认 24）内有更新的会话 `messages.json`，抽取用户/助手正文（去掉 think/tool 过程块），调用 DeepSeek 生成中文简报，写出 markdown 到 ./workspace 供下载。
【调用方式】: python skills/executor/summarize_recent_chats.py "{\"hours\":24}"
【参数说明】 (以 JSON 字符串形式传入):
  - hours: 可选。回看小时数，默认 24，最大 168。
  - all_users: 可选。true 时扫描全站所有工号的会话；默认 false，只看当前登录工号。
  - user_id: 可选。覆盖当前工号；`all_users=true` 时忽略。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - WORKER_DATA_ROOT (必需，由 worker 注入): 会话根目录 `data/users`。
  - WORKER_USER_ID (当前工号，由 worker 注入)
  - WORKER_PROJECT_ROOT (用于定位 gateway/database.sqlite 读会话标题)
  - GATEWAY_DB_PATH (可选，覆盖 sqlite 路径)
  - DEEPSEEK_API_KEY (必需，用于生成摘要)
  - DEEPSEEK_BASE_URL / DEEPSEEK_MODEL (可选)
【判定规则】:
  - 「最近」以 `messages.json` 的修改时间为准（不是会话创建时间），因此老会话只要 24 小时内有新消息也会纳入。
  - 只保留 role=user/assistant 的文本；剥离 `<think>` / `<tool_call>` / `<tool_result>` 和系统通知。
【返回格式】: JSON。成功: {"ok": true, "data": {"output_md","hours","since","session_count","user_ids","sessions","summary","note"}}；失败: {"ok": false, "error", "hint"}。
  - 产物为 markdown 简报，系统会注入 produced_files 并显示下载按钮。回复里只报文件名，禁止编造完整 URL。
【使用注意】:
  - 运营查看全站（含 cmm）时传 `"all_users": true`。
  - 无会话时仍会写出一份说明文件，summary 为「没有找到更新过的会话」。
