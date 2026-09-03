---
name: summarize-recent-chats
description: >-
  Summarizes codex-agent chat sessions from the last 24 hours (or a custom window)
  by scanning messages.json, extracting user/assistant text, and writing a Chinese digest.
  Use when the user asks to 查看最近24小时日志, 对话简报, 会话总结, 聊天记录汇总, review recent chats,
  or summarize production/local agent conversations in this repo.
---

# Summarize Recent Chats

在 **codex-agent** 仓库里查看最近会话并写中文简报。实现以仓库脚本为准，不要另写一套解析逻辑。

## When to run

触发语：最近 24 小时日志 / 对话简报 / 会话总结 / 聊天记录汇总 / review recent chats。

默认：

- 窗口 **24 小时**（用户说「最近 N 小时」则改 `hours`，最大 168）
- 未说「只要某工号」时，生产侧用 `all_users=true`（含 `cmm`）
- 未说「本地」时，优先扫 **59 生产数据**（真实对话在服务器 `shared/data`）

## Hard rules

- 只跑 `skills/executor/summarize_recent_chats.py`，不要手写 grep 全量 `messages.json` 当最终摘要。
- **不要**打印 `gateway/.env` / `shared/.env` 的密钥、密码、token。
- **不要**把 `<think>` / `<tool_call>` / `<tool_result>` 原文贴进回复。
- **不要**编造下载 URL 或服务器绝对路径给用户点；回复用文件名 + 简报正文。
- 回复用中文，结构与脚本一致：总览 / 分会话要点 / 问题与建议。

## Script contract

```bash
python3 skills/executor/summarize_recent_chats.py '{"hours":24,"all_users":true}'
```

常用参数：

| 字段 | 说明 |
|---|---|
| `hours` | 回看小时，默认 24 |
| `all_users` | `true` = 全站；`false` = 仅 `user_id` / `WORKER_USER_ID` |
| `user_id` | 指定工号（如 `1001`、`cmm`） |
| `export_dir` | 输出目录，Cursor 侧用仓库外 tmp 或 `/tmp` |

脚本按 `messages.json` **mtime** 过滤（不是会话创建时间）。环境变量：`WORKER_DATA_ROOT`、`WORKER_USER_ID`、`WORKER_PROJECT_ROOT`、`DEEPSEEK_*`。

## Production (59) — default

```bash
KEY="/Users/chloe/Documents/00011001/1AI知识库-2405 CCSI中国船级社/CCSI.pem"
REMOTE=root@59.110.81.252
APP=/srv/codex-agent/current
DATA=/srv/codex-agent/current/data/users
OUT=/tmp/codex-agent-chat-digest
```

在远端执行（`source` 远端 env，**不要** `cat` 它）：

```bash
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$REMOTE" 'set -euo pipefail
export PATH="/usr/bin:/bin:${PATH}"
set -a
# shellcheck disable=SC1091
source /srv/codex-agent/shared/.env
set +a
export WORKER_DATA_ROOT=/srv/codex-agent/current/data/users
export WORKER_PROJECT_ROOT=/srv/codex-agent/current
export WORKER_USER_ID=1001
mkdir -p /tmp/codex-agent-chat-digest
python3 /srv/codex-agent/current/skills/executor/summarize_recent_chats.py "{\"hours\":24,\"all_users\":true,\"export_dir\":\"/tmp/codex-agent-chat-digest\"}"
'
```

若远端还没有该脚本（未部署），先说明需要部署，或把本地脚本拷到远端 `/tmp` 再跑，并设置 `WORKER_DATA_ROOT` 指向 `current/data/users`。

把生成的 `recent_chats_*h_*.md` 用 `scp` 拉到本地 `/tmp` 后阅读，把简报写进对用户的回复；不要粘贴 `.env`。

## Local

仅当用户明确说本地 / 本机会话：

```bash
cd <repo>
set -a
# shellcheck disable=SC1091
source gateway/.env
set +a
export WORKER_DATA_ROOT="$(pwd)/data/users"
export WORKER_PROJECT_ROOT="$(pwd)"
export WORKER_USER_ID="${WORKER_USER_ID:-1001}"
mkdir -p /tmp/codex-agent-chat-digest
python3 skills/executor/summarize_recent_chats.py '{"hours":24,"all_users":true,"export_dir":"/tmp/codex-agent-chat-digest"}'
```

本地 `data/users` 经常是空的；没有会话时如实报告，不要改去扫生产除非用户同意。

## Report to the user

1. 窗口、范围（全站 / 某工号）、会话数、涉及工号
2. 粘贴脚本返回的 `summary`（或 markdown 里对应章节）
3. 本地保存的简报**文件名**（不要给 `http://59...` 下载链）
4. `session_count=0` 时直接说没有更新过的会话

## Examples

- 「查看最近 24 小时日志并总结」→ 59 + `hours=24` + `all_users=true`
- 「只看 cmm 今天的对话」→ 59 + `all_users=false` + `user_id=cmm`
- 「看本地 12 小时会话」→ Local + `hours=12`
