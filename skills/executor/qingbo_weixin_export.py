#!/usr/bin/env python3
"""Qingbo WeChat-account directed collection (fixed 40-account list).

Ported to the codex-agent sub skill contract (JSON in/out, ./workspace output,
env-only secrets). Dedup by news_uuid / news_url.
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
)

DOMAIN_SEC = "mp.weixin.qq.com"
MEDIA_NAMES = [
    "DT未来产业",
    "DT新材料",
    "视觉语言导航",
    "深蓝具身智能",
    "智驾通鉴",
    "车辆工程研究",
    "芯流汽车",
    "未来汽车Daily",
    "车东西",
    "高工锂电",
    "高工智能汽车",
    "北极星储能网",
    "电车Daily",
    "鑫椤钠电",
    "中国储能网",
    "起点固态电池",
    "中国粉体网",
    "NE时代智能体",
    "汽车与新动力",
    "DT先进电池",
    "聚焦新能源科技",
    "高校科研动态",
    "AI生成未来",
    "投资界",
    "投中网",
    "高动能",
    "腾讯科技",
    "AI汽车制造业",
    "碳索储能",
    "量子位",
    "机器之心",
    "新智元",
    "甲子光年",
    "智能车参考",
    "晚点Auto",
    "36氪汽车",
    "中国汽车报",
    "DeepTech深科技",
    "麻省理工科技评论APP",
    "智东西",
]


def build_params_for(start: str, end: str, page: int) -> dict:
    params = base_params(start, end, page)
    params["match_type"] = "title,content"
    params["media_name"] = ",".join(MEDIA_NAMES)
    params["platform_domain_sec"] = DOMAIN_SEC
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
    for item in items:
        uid = (
            item.get("news_uuid")
            or item.get("news_url")
            or f"{item.get('news_title')}|{item.get('news_posttime')}"
        )
        if str(uid) in seen:
            continue
        seen.add(str(uid))
        row, cut = item_to_row(item)
        truncated += cut
        rows.append(row)

    export_dir.mkdir(parents=True, exist_ok=True)
    stamp_start = start_dt.strftime("%Y%m%d-%H%M")
    stamp_end = end_dt.strftime("%Y%m%d-%H%M")
    out_path = (export_dir / f"qingbo-weixin-{stamp_start}-{stamp_end}.xlsx").resolve()

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
            "exported_rows": len(rows),
            "unique": len(seen),
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
