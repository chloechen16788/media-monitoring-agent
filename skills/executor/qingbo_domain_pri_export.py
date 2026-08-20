#!/usr/bin/env python3
"""Qingbo template B: primary-domain directed collection (topic AND event words).

Ported from the Cursor skill `qingbo-domain-pri-export` to the codex-agent sub
skill contract: JSON args in via argv[1], single JSON result out via stdout,
artifacts written under ./workspace, secrets from environment only.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import httpx
from openpyxl import Workbook

from _qingbo_common import (
    COLUMNS,
    QingboError,
    base_params,
    clamp_end,
    fmt_dt,
    get_creds,
    item_to_row,
    paginate,
    parse_dt,
    title_key,
)

DOMAIN_PRI = [
    "chuneng.bjx.com.cn",
    "escn.com.cn",
    "cnpowder.com.cn",
    "ofweek.com",
    "autoinfo.org.cn",
    "ne-time.cn",
    "cyzone.cn",
    "mittrchina.com",
    "ifanr.com",
    "tmtpost.com",
    "vrtuoluo.cn",
    "ithome.com",
    "36kr.com",
    "geekpark.net",
    "inabr.com",
    "db.shujubang.com",
    "auto.vogel.com.cn",
    "auto.gasgoo.com",
]
EVENT = "(量产,首发,上车,定点,搭载,突破,发布,流片,装车,试产,产业化,试点,下线,测试,国产化,落地)"
TOPICS = [
    ("智驾", "(端到端,VLA,世界模型,DriveGPT,BEV感知,自动驾驶,智驾,辅助驾驶,导航,NOA)"),
    ("传感器", "(激光雷达,毫米波雷达,纯视觉,超远距,避障,汽车传感器,热成像,轮速传感器,惯性导航,乘员监测,固态雷达)"),
    ("芯片", "(软件定义汽车,ISP集成,边缘AI,Chiplet,SiC,hor芯片,J7芯片,1000TOPS,1200TOPS,ASIL-D,SoC)"),
    ("座舱", "(舱驾一体,智能座舱,车载数字人,汽车座椅,儿童检测,车载大模型,全域视觉)"),
    ("电池", "(钠离子,钠电,固态电池,干法电极,CTC电池,复合集流体,大圆柱,高镍,硅碳,硅氧负极,极耳)"),
    ("氢能超充", "(氢燃料氢循环,燃料电池,高压平台,热泵,金属双极板,储能,800V平台,超充)"),
    ("电驱", "(电驱,油冷电机,扁线电机,SiC电控,混磁,高压平台,碳化硅,电驱,整车OTA,超高速电机,液冷技术)"),
    ("底盘", "(线控转向,后轮转向,线控制动,干式制动,双腔空悬,预瞄悬架,轮毂电机,融合底盘,主动悬架,爆胎稳定,电驱底盘)"),
    ("电子架构", "(中央计算区域控制,车载OS,车载以太网,10Base-T1S,UWB测距,低轨卫星通信)"),
    ("座舱硬件", "(HUD,Mini-LED车载屏,车载ANC,智能大灯)"),
    ("制造仿真", "(黑粉提炼,电池护照,黑灯工厂,AI质检,一体化压铸,免热处理铝合金,底盘一体化,3DGS仿真,国产汽车CAE,开发MBD)"),
]


def build_params_for(theme: str, start: str, end: str, page: int) -> dict:
    params = base_params(start, end, page)
    params["keywords_include"] = f"{theme} + {EVENT}"
    params["match_type"] = "title,content"
    params["platform_domain_pri"] = ",".join(DOMAIN_PRI)
    return params


def dedupe_by_title(items: list[dict]) -> tuple[list[dict], int, int]:
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
    return rows, dropped, truncated


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
    counts: list[dict] = []
    topic_items: dict[str, list[dict]] = {}

    with httpx.Client() as client:
        for idx, (name, theme) in enumerate(TOPICS, 1):
            if count_only:
                body = fetch_first(client, creds, name, theme, start, end)
                counts.append(body)
                continue
            items, total = paginate(
                client, creds, lambda page, t=theme: build_params_for(t, start, end, page),
                label=f"{idx}/{len(TOPICS)} {name}",
            )
            topic_items[name] = items
            counts.append({"topic": name, "total": total, "fetched": len(items)})

    result: dict = {
        "start": start,
        "end": end,
        "count_only": count_only,
        "counts": counts,
        "total_hits": sum(int(c.get("total") or 0) for c in counts),
    }
    if clamp_note:
        result["clamp_note"] = clamp_note
    if count_only:
        return result

    truncated = 0
    all_rows: list[dict] = []
    all_seen: set[str] = set()
    wb = Workbook()
    ws_all = wb.active
    ws_all.title = "all"
    ws_all.append([col for col, _ in COLUMNS])

    sheet_stats = []
    for name, _theme in TOPICS:
        rows, dropped, cut = dedupe_by_title(topic_items.get(name, []))
        truncated += cut
        ws = wb.create_sheet(name[:31])
        ws.append([col for col, _ in COLUMNS])
        for row in rows:
            ws.append([row[col] for col, _ in COLUMNS])
            key = title_key(row.get("title") or "")
            if key in all_seen:
                continue
            all_seen.add(key)
            all_rows.append(row)
        sheet_stats.append({"topic": name, "rows": len(rows), "title_dropped": dropped})

    for row in all_rows:
        ws_all.append([row[col] for col, _ in COLUMNS])

    export_dir.mkdir(parents=True, exist_ok=True)
    stamp_start = start_dt.strftime("%Y%m%d-%H%M")
    stamp_end = end_dt.strftime("%Y%m%d-%H%M")
    out_path = (export_dir / f"qingbo-domain-pri-{stamp_start}-{stamp_end}.xlsx").resolve()
    wb.save(out_path)

    result.update(
        {
            "output_path": str(out_path),
            "exported_unique": len(all_rows),
            "truncated_cells": truncated,
            "sheets": sheet_stats,
        }
    )
    return result


def fetch_first(client, creds, name, theme, start, end) -> dict:
    from _qingbo_common import extract_list, fetch_page

    body = fetch_page(client, creds, build_params_for(theme, start, end, 1))
    _lst, total, last_page = extract_list(body)
    return {"topic": name, "total": total, "last_page": last_page}


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
