# Codex-Agent 部署验收清单

## 1) 服务状态
- `systemctl is-active codex-agent-gateway` 返回 `active`
- `nginx -t` 校验通过
- `systemctl is-active nginx` 返回 `active`

## 2) API 连通性
- 本机直连：`curl -fsS "http://127.0.0.1:3000/api/projects?userId=1001"`
- nginx 反代：`curl -fsS "http://127.0.0.1:8094/api/projects?userId=1001"`

## 3) SSE 与 Tool Call 验证
- 使用真实会话参数发送 `/api/chat`，确认响应是持续流式输出，不出现长时间卡住
- 触发一次 `cat skills/catalog.json` 类 tool call，确认 SSE 中出现：
  - `role=assistant`（含 `tool_calls`）
  - `role=tool`（工具回写）
  - 最终 assistant 文本回复
- Worker 运行时检查：
  - `grep WORKER_NODE_BIN /srv/codex-agent/shared/.env`
  - `/srv/codex-agent/shared/bin/node20 -v` 应为 `v20.x`
  - gateway 进程用 Node 22（`/usr/bin/node`），worker 子进程用 Node 20（`WORKER_NODE_BIN`）
- nginx 已开启：
  - `proxy_buffering off`
  - `proxy_read_timeout 3600s`
  - `X-Accel-Buffering no`

## 4) 前端页面
- 浏览器访问 `http://59.110.81.252:8094`
- 刷新任意前端路由无 404（`try_files ... /index.html` 生效）

## 5) 上传下载
- 上传文件成功
- 通过下载链接可正常取回同一文件

## 6) 安全与端口
- 安全组仅开放 `22`（建议限源）和 `8094`
- `3000` 未对公网开放

## 7) 回滚演练
- 查看版本：`ls -1dt /srv/codex-agent/releases/*/`
- 软链回滚后可正常重启：
  - `ln -sfn /srv/codex-agent/releases/<prev_id> /srv/codex-agent/current`
  - `systemctl restart codex-agent-gateway`
  - `systemctl reload nginx`
