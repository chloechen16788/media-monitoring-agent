#!/usr/bin/env python3
"""Export chat sessions whose messages.json was updated in the last N hours.

Reads session histories under WORKER_DATA_ROOT (default current user only).
Writes a markdown digest or transcript to ./workspace for download.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PROCESS_BLOCK_RE = re.compile(r"<(think|tool_call|tool_result)>[\s\S]*?</\1>", re.IGNORECASE)
HIDDEN_RE = re.compile(r"^\[(系统通知|隐藏回复)\]")
MAX_SESSION_CHARS = 6000
MAX_DIGEST_CHARS = 48000
TZ_SH = timezone(timedelta(hours=8))


class DigestError(Exception):
    pass


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def resolve_data_root() -> Path:
    raw = (os.environ.get("WORKER_DATA_ROOT") or "").strip()
    if raw:
        p = Path(raw)
        if p.is_dir():
            return p.resolve()
    project = (os.environ.get("WORKER_PROJECT_ROOT") or "").strip()
    if project:
        p = Path(project) / "data" / "users"
        if p.is_dir():
            return p.resolve()
    raise DigestError("找不到会话数据目录（缺少 WORKER_DATA_ROOT）")


def resolve_db_path(project_root: Path) -> Path | None:
    env = (os.environ.get("GATEWAY_DB_PATH") or "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.append(project_root / "gateway" / "database.sqlite")
    for p in candidates:
        if p.is_file():
            return p.resolve()
    return None


def content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    if isinstance(content, dict):
        return str(content.get("text") or content.get("content") or "")
    return str(content)


def clean_text(text: str) -> str:
    cleaned = PROCESS_BLOCK_RE.sub("", text or "")
    lines = [ln for ln in cleaned.splitlines() if not HIDDEN_RE.match(ln.strip())]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def load_session_meta(db_path: Path | None) -> dict[str, dict[str, str]]:
    if not db_path:
        return {}
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT session_id, user_id, project_id, title, created_at FROM sessions"
        ).fetchall()
        conn.close()
    except Exception:
        return {}
    out: dict[str, dict[str, str]] = {}
    for row in rows:
        sid = str(row["session_id"] or "")
        if not sid:
            continue
        out[sid] = {
            "user_id": str(row["user_id"] or ""),
            "project_id": str(row["project_id"] or ""),
            "title": str(row["title"] or ""),
            "created_at": str(row["created_at"] or ""),
        }
    return out


def extract_turns(history: list[Any]) -> list[dict[str, str]]:
    turns: list[dict[str, str]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        text = clean_text(content_to_text(item.get("content")))
        if not text:
            continue
        turns.append({"role": role, "text": text})
    return turns


def format_session_block(info: dict[str, Any]) -> str:
    turns = info["turns"]
    body_parts: list[str] = []
    used = 0
    for turn in turns:
        label = "用户" if turn["role"] == "user" else "助手"
        chunk = f"{label}: {turn['text']}"
        if used + len(chunk) > MAX_SESSION_CHARS:
            remain = MAX_SESSION_CHARS - used
            if remain > 80:
                body_parts.append(chunk[:remain] + "…")
            body_parts.append("（后续已截断）")
            break
        body_parts.append(chunk)
        used += len(chunk) + 1
    header = (
        f"### 会话 {info['session_id']}\n"
        f"- 用户: {info['user_id']}\n"
        f"- 标题: {info['title'] or '（无标题）'}\n"
        f"- 最近更新: {info['updated_at']}\n"
        f"- 轮次: {info['turn_count']}"
    )
    return header + "\n\n" + "\n\n".join(body_parts)


def call_summarizer(transcript: str, hours: int, session_count: int) -> str:
    api_key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        raise DigestError("缺少 DEEPSEEK_API_KEY 环境变量")
    base_url = (os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
    model = os.getenv("DEEPSEEK_MODEL") or "deepseek-v4-flash"
    prompt = f"""你是对话日志分析助手。下面是最近 {hours} 小时内、共 {session_count} 个会话的摘录。
请用中文写一份简报，结构固定为：

## 总览
用几句话说明活跃用户、会话数量、主要在做什么。

## 分会话要点
每个会话 3–6 条要点：用户目标、关键操作/技能、是否产出文件、是否失败。

## 问题与建议
共性问题、报错、未完成事项。若没有则写「无」。

要求：不要复述全文，不要编造没有出现的内容，不要输出下载 URL。

【会话摘录】
{transcript}
""".strip()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "extra_body": {"thinking": {"type": "disabled"}},
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    req = Request(
        f"{base_url}/chat/completions",
        method="POST",
        headers=headers,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
    )
    try:
        with urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        return str(data["choices"][0]["message"]["content"]).strip()
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")[:400]
        raise DigestError(f"摘要模型调用失败 HTTP {err.code}: {detail}") from err
    except Exception as err:  # noqa: BLE001
        raise DigestError(f"摘要模型调用失败: {err}") from err


def scan_sessions(
    data_root: Path,
    cutoff_ts: float,
    user_filter: str | None,
    all_users: bool,
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if not data_root.is_dir():
        return found
    user_dirs = [data_root / user_filter] if user_filter and not all_users else [
        p for p in data_root.iterdir() if p.is_dir()
    ]
    for user_dir in user_dirs:
        if not user_dir.is_dir():
            continue
        projects_dir = user_dir / "projects"
        if not projects_dir.is_dir():
            continue
        for project_dir in projects_dir.iterdir():
            sessions_dir = project_dir / "sessions"
            if not sessions_dir.is_dir():
                continue
            for session_dir in sessions_dir.iterdir():
                history = session_dir / "messages.json"
                if not history.is_file():
                    continue
                mtime = history.stat().st_mtime
                if mtime < cutoff_ts:
                    continue
                try:
                    payload = json.loads(history.read_text(encoding="utf-8"))
                except Exception:
                    continue
                items = payload if isinstance(payload, list) else []
                turns = extract_turns(items)
                updated = datetime.fromtimestamp(mtime, TZ_SH).strftime("%Y-%m-%d %H:%M:%S")
                found.append(
                    {
                        "session_id": session_dir.name,
                        "user_id": user_dir.name,
                        "project_id": project_dir.name,
                        "title": "",
                        "updated_at": updated,
                        "updated_ts": mtime,
                        "turn_count": len(turns),
                        "turns": turns,
                    }
                )
    found.sort(key=lambda x: x["updated_ts"], reverse=True)
    return found


def run(params: dict) -> dict:
    hours = float(params.get("hours") or 24)
    if hours <= 0 or hours > 168:
        raise DigestError("hours 必须在 0 到 168 之间")
    all_users = bool(params.get("all_users", False))
    user_filter = str(params.get("user_id") or os.environ.get("WORKER_USER_ID") or "").strip()
    if all_users:
        user_filter = ""
    elif not user_filter:
        raise DigestError("未指定 user_id，且当前进程没有 WORKER_USER_ID")

    export_dir = Path(params.get("export_dir") or "./workspace")
    data_root = resolve_data_root()
    project_root = Path(os.environ.get("WORKER_PROJECT_ROOT") or data_root.parents[1])
    cutoff_ts = time.time() - hours * 3600
    since = datetime.fromtimestamp(cutoff_ts, TZ_SH).strftime("%Y-%m-%d %H:%M:%S")

    print(f"扫描最近 {hours:g} 小时会话，since={since}", file=sys.stderr, flush=True)
    sessions = scan_sessions(data_root, cutoff_ts, user_filter or None, all_users)
    meta = load_session_meta(resolve_db_path(project_root))
    for item in sessions:
        extra = meta.get(item["session_id"]) or {}
        if extra.get("title"):
            item["title"] = extra["title"]

    stamp = datetime.now(TZ_SH).strftime("%Y%m%d-%H%M")
    export_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"recent_chats_{int(hours)}h_{stamp}.md"
    out_path = (export_dir / out_name).resolve()

    if not sessions:
        text = (
            f"# 最近 {hours:g} 小时对话简报\n\n"
            f"- 统计起点: {since}（Asia/Shanghai）\n"
            f"- 范围: {'全站' if all_users else user_filter}\n\n"
            "没有找到更新过的会话。"
        )
        out_path.write_text(text, encoding="utf-8")
        return {
            "output_md": str(out_path),
            "hours": hours,
            "since": since,
            "session_count": 0,
            "user_ids": [],
            "summary": "最近时段没有更新过的会话。",
            "note": "请点击下载按钮获取 markdown 简报。",
        }

    blocks = [format_session_block(s) for s in sessions]
    transcript = "\n\n---\n\n".join(blocks)
    if len(transcript) > MAX_DIGEST_CHARS:
        transcript = transcript[:MAX_DIGEST_CHARS] + "\n\n（总摘录已截断）"

    user_ids = sorted({s["user_id"] for s in sessions})
    summary_mode = str(params.get("summary_mode") or "external").strip().lower()
    if summary_mode in {"none", "codex", "local"}:
        print(f"导出摘录：{len(sessions)} 个会话；不调用外部摘要模型", file=sys.stderr, flush=True)
        summary = "已导出会话摘录，未调用外部摘要模型；请由当前 Codex 线程基于本地摘录生成中文简报。"
        md = (
            f"# 最近 {hours:g} 小时对话摘录\n\n"
            f"- 生成时间: {datetime.now(TZ_SH).strftime('%Y-%m-%d %H:%M:%S')}（Asia/Shanghai）\n"
            f"- 统计起点: {since}\n"
            f"- 范围: {'全站' if all_users else user_filter}\n"
            f"- 会话数: {len(sessions)}\n"
            f"- 用户: {', '.join(user_ids)}\n"
            f"- 摘要方式: Codex 本线程总结（脚本未调用外部模型）\n\n"
            "## 会话摘录\n\n"
            f"{transcript}\n"
        )
        out_path.write_text(md, encoding="utf-8")
        return {
            "output_md": str(out_path),
            "hours": hours,
            "since": since,
            "session_count": len(sessions),
            "user_ids": user_ids,
            "sessions": [
                {
                    "session_id": s["session_id"],
                    "user_id": s["user_id"],
                    "title": s["title"],
                    "updated_at": s["updated_at"],
                    "turn_count": s["turn_count"],
                }
                for s in sessions
            ],
            "summary": summary,
            "note": "请将 markdown 摘录拉回本机后，由 Codex 在当前线程生成中文简报。",
        }

    print(f"生成摘要：{len(sessions)} 个会话", file=sys.stderr, flush=True)
    summary = call_summarizer(transcript, hours, len(sessions))
    md = (
        f"# 最近 {hours:g} 小时对话简报\n\n"
        f"- 生成时间: {datetime.now(TZ_SH).strftime('%Y-%m-%d %H:%M:%S')}（Asia/Shanghai）\n"
        f"- 统计起点: {since}\n"
        f"- 范围: {'全站' if all_users else user_filter}\n"
        f"- 会话数: {len(sessions)}\n"
        f"- 用户: {', '.join(user_ids)}\n\n"
        f"{summary}\n"
    )
    out_path.write_text(md, encoding="utf-8")
    return {
        "output_md": str(out_path),
        "hours": hours,
        "since": since,
        "session_count": len(sessions),
        "user_ids": user_ids,
        "sessions": [
            {
                "session_id": s["session_id"],
                "user_id": s["user_id"],
                "title": s["title"],
                "updated_at": s["updated_at"],
                "turn_count": s["turn_count"],
            }
            for s in sessions
        ],
        "summary": summary[:4000],
        "note": "请点击下载按钮获取完整 markdown 简报，不要编造下载链接。",
    }


def main() -> None:
    try:
        raw = sys.argv[1] if len(sys.argv) > 1 else ""
        args = json.loads(raw) if raw.strip() else {}
        if not isinstance(args, dict):
            raise DigestError("参数 JSON 必须是对象")
        data = run(args)
        _emit({"ok": True, "data": data})
    except DigestError as err:
        _emit({"ok": False, "error": str(err), "hint": "确认 WORKER_DATA_ROOT / DEEPSEEK_API_KEY，并指定 hours 或 all_users"})
    except Exception as err:  # noqa: BLE001
        _emit({"ok": False, "error": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
