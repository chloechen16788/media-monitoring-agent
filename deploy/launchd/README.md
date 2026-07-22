# 本地 launchd 托管

使用 `launchd` 托管本项目两个本地服务：

- `com.chloe.codex-agent.gateway`：`gateway/server.js`（端口 `3000`）
- `com.chloe.codex-agent.frontend`：`frontend` Vite dev server（端口 `5179`）

## 一键重启并托管

```bash
bash deploy/launchd/manage_launchd.sh restart
```

## 配置 BMW 标注模型环境变量

如需启用 BMW 的 Gemini/Gateway 标注，请先准备：

```bash
cp deploy/launchd/tagging.env.example deploy/launchd/tagging.env
```

再编辑 `deploy/launchd/tagging.env`，至少填入 `SKILL_TAGGING_API_KEY`（Gemini 场景），然后执行 `restart`。

## 常用命令

```bash
bash deploy/launchd/manage_launchd.sh install
bash deploy/launchd/manage_launchd.sh status
bash deploy/launchd/manage_launchd.sh stop
```

日志默认写入：

- `logs/launchd/gateway.stdout.log`
- `logs/launchd/gateway.stderr.log`
- `logs/launchd/frontend.stdout.log`
- `logs/launchd/frontend.stderr.log`
