#!/usr/bin/env python3
"""Shared helpers for the three Qingbo export skills.

Secrets are read ONLY from environment variables (the sandboxed skill runs with
cwd inside the session dir, so no .env is available). The gateway injects the
declared QINGBO_* keys into the worker environment.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta

import httpx

EXCEL_CELL_MAX = 32767
PLATFORM = "wx,weibo,web,app,bbs,journal,aq,media,video,media_toutiao"

COLUMNS = [
    ("title", "news_title"),
    ("news_digest", "news_digest"),
    ("news_author", "news_author"),
    ("media_name", "media_name"),
    ("platform_name", "platform_name"),
    ("news_url", "news_url"),
    ("news_posttime", "news_posttime"),
    ("content", "news_content"),
]


class QingboError(Exception):
    """Raised for user-facing Qingbo failures (bad time / missing creds / upstream)."""


def parse_dt(raw: str) -> datetime:
    text = (raw or "").strip().replace("T", " ").replace("/", "-")
    text = re.sub(r"年|月", "-", text).replace("日", "").replace(".", "-")
    text = re.sub(r"\s+", " ", text).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(text, fmt)
            if fmt == "%Y-%m-%d":
                dt = dt.replace(hour=10, minute=30, second=0)
            elif fmt == "%Y-%m-%d %H:%M":
                dt = dt.replace(second=0)
            return dt
        except ValueError:
            continue
    raise QingboError(f"无法解析时间: {raw!r}，请用 YYYY-MM-DD HH:MM:SS")


def fmt_dt(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def clamp_end(end_dt: datetime) -> tuple[datetime, str]:
    """Qingbo rejects an end time newer than now-5min; clamp it."""
    now_cutoff = datetime.now() - timedelta(minutes=5)
    if end_dt > now_cutoff:
        return now_cutoff, f"posttime_end 已夹紧到 {fmt_dt(now_cutoff)} (now-5min)"
    return end_dt, ""


def strip_html(value: str) -> str:
    text = value or ""
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", text).strip()


def title_key(value: str) -> str:
    return re.sub(r"\s+", " ", strip_html(value or "")).strip()


def cell(text: str) -> tuple[str, bool]:
    text = text or ""
    if len(text) > EXCEL_CELL_MAX:
        return text[: EXCEL_CELL_MAX - 16] + "...[TRUNCATED]", True
    return text, False


def get_creds() -> tuple[str, str, str, str]:
    """Read Qingbo credentials from the environment only."""
    base = (os.getenv("QINGBO_BASE_URL") or "").strip()
    project_id = (os.getenv("QINGBO_PROJECT_ID") or "").strip()
    sign = (os.getenv("QINGBO_SIGN") or "").strip()
    router = (os.getenv("QINGBO_ROUTER") or "/prnasia/api/get-history-data").strip()
    if not base or not project_id or not sign:
        raise QingboError(
            "缺少 QINGBO_BASE_URL / QINGBO_PROJECT_ID / QINGBO_SIGN 环境变量"
        )
    return base, project_id, sign, router


def fetch_page(client: httpx.Client, creds: tuple[str, str, str, str], params: dict) -> dict:
    base, project_id, sign, router = creds
    resp = client.post(
        base,
        data={
            "project_id": project_id,
            "sign": sign,
            "router": router,
            "params": json.dumps(params, ensure_ascii=False),
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=90.0,
    )
    resp.raise_for_status()
    return resp.json()


def base_params(start: str, end: str, page: int, limit: int = 50) -> dict:
    return {
        "posttime_start": start,
        "posttime_end": end,
        "platform": PLATFORM,
        "paging_type": "page",
        "page": page,
        "limit": limit,
        "sort": "news_posttime",
        "order": "desc",
        "is_content_html": 0,
    }


def extract_list(body: dict) -> tuple[list, int, int]:
    data = body.get("data") if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        raise QingboError("清博上游返回异常")
    lst = data.get("list") if isinstance(data.get("list"), list) else []
    total = int(data.get("total") or 0)
    last_page = max(1, int(data.get("last_page") or 1))
    return lst, total, last_page


def item_to_row(item: dict) -> tuple[dict, int]:
    row: dict = {}
    truncated = 0
    for out_col, src_col in COLUMNS:
        raw = item.get(src_col)
        text = "" if raw is None else str(raw)
        if out_col in {"title", "content"}:
            text = strip_html(text)
        value, was_cut = cell(text)
        if was_cut:
            truncated += 1
        row[out_col] = value
    return row, truncated


def paginate(
    client: httpx.Client,
    creds: tuple[str, str, str, str],
    build_params,
    sleep_sec: float = 0.25,
    label: str = "",
) -> tuple[list, int]:
    """Fetch page 1..last_page for a params builder. Returns (items, total)."""
    tag = f"[{label}] " if label else ""
    body = fetch_page(client, creds, build_params(1))
    lst, total, last_page = extract_list(body)
    items = list(lst)
    print(f"{tag}第 1/{last_page} 页，累计 {len(items)} 条", file=sys.stderr, flush=True)
    for page in range(2, last_page + 1):
        time.sleep(sleep_sec)
        page_body = fetch_page(client, creds, build_params(page))
        page_list, _, _ = extract_list(page_body)
        items.extend(page_list)
        print(f"{tag}第 {page}/{last_page} 页，累计 {len(items)} 条", file=sys.stderr, flush=True)
        if not page_list:
            break
    return items, total
