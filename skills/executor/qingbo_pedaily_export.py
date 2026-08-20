#!/usr/bin/env python3
"""Qingbo template C: pedaily.cn title search for `IPO,融资`, dedup by title.

Ported to the codex-agent sub skill contract (JSON in/out, ./workspace output,
env-only secrets).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from openpyxl import Workbook

from _qingbo_common import (
    COLUMNS,
    QingboError,
    base_params,
    clamp_end,
    extract_list,
    fetch_page,
    fmt_dt,
    get_creds,
    item_to_row,
    paginate,
    parse_dt,
    title_key,
)

KEYWORDS = "IPO,融资"
DOMAIN_PRI = "pedaily.cn"


def build_params_for(start: str, end: str, page: int) -> dict:
    params = base_params(start, end, page)
    params["keywords_include"] = KEYWORDS
    params["match_type"] = "title"
    params["platform_domain_pri"] = DOMAIN_PRI
    return params


def run(params: dict) -> dict:
    start_raw = params.get("start")
    end_raw = params.get("end")
    if not start_raw or not end_raw:
        raise QingboError("必须提供 start 与 end（YYYY-MM-DD HH:MM:SS）")
    count_only = bool(params.get("count_only", False))
    export_dir = Path(params.get("export_dir") or "./workspace")

    start_dt = parse_dt(str(start_raw))
    end_dt = parse_dt(str(end_raw))
    if start_dt > end_dt:
        raise QingboError("起始时间不能晚于结束时间")
    end_dt, clamp_note = clamp_end(end_dt)
    start = fmt_dt(start_dt)
    end = fmt_dt(end_dt)

    creds = get_creds()
    result: dict = {"start": start, "end": end, "count_only": count_only}
    if clamp_note:
        result["clamp_note"] = clamp_note

    with httpx.Client() as client:
        if count_only:
            body = fetch_page(client, creds, build_params_for(start, end, 1))
            _lst, total, last_page = extract_list(body)
            result.update({"total": total, "last_page": last_page})
            return result
        items, total = paginate(client, creds, lambda page: build_params_for(start, end, page))

    rows: list[dict] = []
    seen: set[str] = set()
    truncated = 0
    dropped = 0
    for item in items:
        row, cut = item_to_row(item)
        truncated += cut
        key = title_key(row.get("title") or "")
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        rows.append(row)

    export_dir.mkdir(parents=True, exist_ok=True)
    stamp_start = start_dt.strftime("%Y%m%d-%H%M")
    stamp_end = end_dt.strftime("%Y%m%d-%H%M")
    out_path = (export_dir / f"qingbo-pedaily-{stamp_start}-{stamp_end}.xlsx").resolve()

    wb = Workbook()
    ws = wb.active
    ws.title = "data"
    ws.append([col for col, _ in COLUMNS])
    for row in rows:
        ws.append([row[col] for col, _ in COLUMNS])
    wb.save(out_path)

    result.update(
        {
            "output_path": str(out_path),
            "raw_rows": len(items),
            "title_dedup": len(rows),
            "title_dropped": dropped,
            "truncated_cells": truncated,
            "total": total,
        }
    )
    return result


def main() -> None:
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
        data = run(args if isinstance(args, dict) else {})
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    except QingboError as err:
        print(json.dumps({"ok": False, "error": str(err), "hint": "确认时间范围与 QINGBO_* 环境变量"}, ensure_ascii=False))
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
