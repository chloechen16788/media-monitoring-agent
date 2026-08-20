#!/usr/bin/env python3
"""Doubao web_search (QueryRewrite on) with multi-query concurrency, export xlsx.

Ported from the Cursor skill `doubao-search` to the codex-agent sub skill
contract. Used for both general 取数 and 专利检索 (just pass patent queries).
Secrets from environment only (DOUBAO_API_KEY).
"""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from openpyxl import Workbook

API_URL = "https://open.feedcoopapi.com/search_api/web_search"
FIELD_SPECS = [
    ("标题", "Title"),
    ("相关摘要", "Summary"),
    ("媒体/站点", "SiteName"),
    ("链接", "Url"),
    ("发布时间", "PublishTime"),
    ("正文", "Content"),
    ("权威度描述", "AuthInfoDes"),
    ("权威度等级", "AuthInfoLevel"),
]
DATE_RANGE_RE = re.compile(
    r"(?P<start_month>\d{1,2})\s*[./月]\s*(?P<start_day>\d{1,2})\s*[-~—到至]\s*"
    r"(?P<end_month>\d{1,2})\s*[./月]\s*(?P<end_day>\d{1,2})"
)


class DoubaoError(Exception):
    pass


def get_api_key() -> str:
    key = (os.getenv("DOUBAO_API_KEY") or "").strip()
    if not key:
        raise DoubaoError("缺少 DOUBAO_API_KEY 环境变量")
    return key


def call_doubao_search(api_key: str, query: str) -> dict:
    payload = {
        "Query": query,
        "SearchType": "web",
        "Count": 30,
        "Filter": {"NeedContent": True, "NeedUrl": True},
        "QueryControl": {"QueryRewrite": True},
    }
    req = Request(
        API_URL,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    )
    try:
        with urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise DoubaoError(f"HTTP {error.code}: {detail[:300]}") from error
    except Exception as error:  # noqa: BLE001
        raise DoubaoError(f"请求失败: {error}") from error
    meta_error = (data.get("ResponseMetadata") or {}).get("Error")
    if meta_error:
        raise DoubaoError(f"接口返回错误: {meta_error}")
    return data


def parse_query_date_range(query: str, year: int):
    match = DATE_RANGE_RE.search(query)
    if not match:
        return None
    try:
        start = date(year, int(match.group("start_month")), int(match.group("start_day")))
        end = date(year, int(match.group("end_month")), int(match.group("end_day")))
    except ValueError:
        return None
    if end < start:
        end = date(year + 1, end.month, end.day)
    return start, end


def parse_publish_date(raw_publish_time: str, fallback_year: int):
    text = (raw_publish_time or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    md_match = re.search(r"(?P<month>\d{1,2})[./月](?P<day>\d{1,2})", text)
    if md_match:
        try:
            return date(fallback_year, int(md_match.group("month")), int(md_match.group("day")))
        except ValueError:
            return None
    return None


def in_date_range(publish_time: str, query_range, fallback_year: int) -> bool:
    if query_range is None:
        return True
    publish_date = parse_publish_date(publish_time, fallback_year)
    if publish_date is None:
        return False
    start, end = query_range
    return start <= publish_date <= end


def build_rows(items: list[dict], query_range, fallback_year: int) -> list[dict]:
    rows = []
    for item in items:
        title = (item.get("Title") or "").strip()
        if not title:
            continue
        if not in_date_range(item.get("PublishTime", ""), query_range, fallback_year):
            continue
        row = {}
        for _, en in FIELD_SPECS:
            if en == "Summary":
                row[en] = item.get("Summary") or item.get("Snippet") or ""
            else:
                row[en] = item.get(en, "")
        rows.append(row)
    return rows


def export_excel(rows: list[dict], out_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "doubao_search"
    ws.append([f"{zh} ({en})" for zh, en in FIELD_SPECS])
    for row in rows:
        ws.append([row.get(en, "") for _, en in FIELD_SPECS])
    widths = {"A": 42, "B": 64, "C": 20, "D": 54, "E": 24, "F": 72, "G": 18, "H": 18}
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    wb.save(out_path)


def run(params: dict) -> dict:
    queries = params.get("queries")
    if isinstance(queries, str):
        queries = [queries]
    if not queries or not isinstance(queries, list):
        raise DoubaoError("必须提供 queries（字符串数组）")
    queries = [str(q).strip() for q in queries if str(q).strip()]
    if not queries:
        raise DoubaoError("queries 为空")
    max_workers = max(1, int(params.get("max_workers", 3)))
    export_dir = Path(params.get("export_dir") or "./workspace")

    api_key = get_api_key()
    current_year = datetime.now().year
    all_rows: list[dict] = []
    per_query: list[dict] = []

    total_q = len(queries)
    done_q = 0
    print(f"开始搜索：{total_q} 个查询，并发 {max_workers}", file=sys.stderr, flush=True)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        fut_map = {pool.submit(call_doubao_search, api_key, q): q for q in queries}
        for fut in as_completed(fut_map):
            query = fut_map[fut]
            done_q += 1
            print(f"搜索进度 {done_q}/{total_q}", file=sys.stderr, flush=True)
            try:
                data = fut.result()
                items = (data.get("Result") or {}).get("WebResults") or []
                query_range = parse_query_date_range(query, current_year)
                rows = build_rows(items, query_range, current_year)
                all_rows.extend(rows)
                per_query.append({"query": query, "ok": True, "rows": len(rows)})
            except Exception as error:  # noqa: BLE001
                per_query.append({"query": query, "ok": False, "error": str(error)})

    seen_titles: set[str] = set()
    dedup_rows: list[dict] = []
    for row in all_rows:
        title_key = (row.get("Title") or "").strip().lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        dedup_rows.append(row)

    export_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = (export_dir / f"doubao_search_export_{stamp}.xlsx").resolve()
    export_excel(dedup_rows, out_path)

    return {
        "output_path": str(out_path),
        "total_rows": len(dedup_rows),
        "queries": per_query,
    }


def main() -> None:
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
        data = run(args if isinstance(args, dict) else {})
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    except DoubaoError as err:
        print(json.dumps({"ok": False, "error": str(err), "hint": "确认 queries 与 DOUBAO_API_KEY 环境变量"}, ensure_ascii=False))
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
