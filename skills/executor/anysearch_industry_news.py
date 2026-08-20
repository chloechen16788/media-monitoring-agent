#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Search 11 fixed China industry topics via AnySearch and merge into Excel.

Ported from the Cursor skill `anysearch-industry-news` to the codex-agent sub
skill contract (JSON in/out, ./workspace output). Secrets are read from the
environment first (ANYSEARCH_API_KEY), then ~/.cursor/mcp.json as a fallback.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path

import pandas as pd

API_URL = "https://api.anysearch.com/v1/search"
MAX_PER_TOPIC = 50
MAX_WORKERS = 4

TOPICS = [
    {"name": "具身智能", "sheet": "01_具身智能", "templates": [
        "{range_cn} 中国具身智能 人形机器人 灵巧手 机械臂 工业机器人 新闻",
        "{month_cn} 中国 人形机器人 灵巧手 算法 导航 发布 新品",
        "{range_short} 宇树 智元 银河通用 法奥 中科慧思 具身智能",
        "{month_cn} 中国工业机器人 机械臂 具身智能 技术发布",
        "{month_cn} 越疆 星动纪元 墨甲 人形机器人 发布",
    ]},
    {"name": "智驾算法", "sheet": "02_智驾算法", "templates": [
        "{range_cn} 中国智驾算法 企业 新产品 技术发布",
        "{month_cn} 自动驾驶 端到端 大模型 华为 地平线 毫末 发布",
        "{range_short} 智能驾驶 算法 技术 新品 中国",
        "{month_cn} 中国 ADAS NOA 智驾 算法 发布",
        "{month_cn} 小鹏 理想 蔚来 比亚迪 智驾 算法 更新",
    ]},
    {"name": "传感器", "sheet": "03_传感器", "templates": [
        "{range_cn} 中国传感器 企业 新产品 技术发布",
        "{month_cn} 激光雷达 毫米波雷达 摄像头 传感器 发布 中国汽车",
        "{range_short} 速腾 禾赛 华为 图达通 传感器 新品",
        "{month_cn} 中国 MEMS 惯性传感器 压力传感器 新品发布",
        "{month_cn} 汽车传感器 国产 技术发布",
    ]},
    {"name": "汽车芯片", "sheet": "04_汽车芯片", "templates": [
        "{range_cn} 中国汽车芯片 企业 新产品 技术发布",
        "{month_cn} 车规芯片 智驾芯片 MCU 发布 地平线 黑芝麻 芯驰",
        "{range_short} 汽车半导体 国产芯片 新品",
        "{month_cn} 华为 车载芯片 发布 中国",
        "{month_cn} 中国车规级芯片 量产 发布",
    ]},
    {"name": "汽车座舱", "sheet": "05_汽车座舱", "templates": [
        "{range_cn} 中国汽车座舱 企业 新产品 技术发布",
        "{month_cn} 智能座舱 座舱域控 HUD 发布 中国",
        "{range_short} 德赛西威 华为乾崑 座舱 新品",
        "{month_cn} 车载屏 语音助手 座舱OS 发布",
        "{month_cn} 中国智能座舱 大模型 发布",
    ]},
    {"name": "汽车电池", "sheet": "06_汽车电池", "templates": [
        "{range_cn} 中国汽车电池 企业 新产品 技术发布",
        "{month_cn} 动力电池 宁德时代 比亚迪刀片 固态电池 发布",
        "{range_short} 中创新航 国轩高科 蜂巢能源 新品",
        "{month_cn} 中国动力电池 半固态 钠离子 发布",
        "{month_cn} 电动汽车电池 技术发布 中国",
    ]},
    {"name": "储能", "sheet": "07_储能", "templates": [
        "{range_cn} 中国储能 企业 新产品 技术发布",
        "{month_cn} 储能系统 液冷储能 大储 发布 宁德 阳光电源",
        "{range_short} 新型储能 钠电储能 发布 中国",
        "{month_cn} 中国储能电站 电池柜 新品",
        "{month_cn} 工商业储能 户储 技术发布",
    ]},
    {"name": "三电", "sheet": "08_三电", "templates": [
        "{range_cn} 中国三电 电机 电控 电池 企业 新产品 技术发布",
        "{month_cn} 电驱动 电控 逆变器 发布 汇川 精进电动",
        "{range_short} 中国新能源汽车 三电系统 新品",
        "{month_cn} 扁线电机 碳化硅电控 发布 中国",
        "{month_cn} 电驱总成 技术发布 中国",
    ]},
    {"name": "汽车底盘", "sheet": "09_汽车底盘", "templates": [
        "{range_cn} 中国汽车底盘 企业 新产品 技术发布",
        "{month_cn} 线控底盘 空气悬架 转向 制动 发布",
        "{range_short} 伯特利 拓普 底盘 新品",
        "{month_cn} 滑板底盘 线控制动 中国 发布",
        "{month_cn} 智能底盘 域控制器 技术发布",
    ]},
    {"name": "车联网", "sheet": "10_车联网", "templates": [
        "{range_cn} 中国车联网 企业 新产品 技术发布",
        "{month_cn} V2X 车路协同 5G-A 发布 中国",
        "{range_short} 高德 四维图新 车联网 新品",
        "{month_cn} 车联网模组 T-Box 发布 中国",
        "{month_cn} C-V2X 智能网联 技术发布",
    ]},
    {"name": "工业制造", "sheet": "11_工业制造", "templates": [
        "{range_cn} 中国工业制造 企业 新产品 技术发布",
        "{month_cn} 工业机器人 智能制造 数控 发布 中国",
        "{range_short} 工控 PLC 工业软件 新品",
        "{month_cn} 中国工业母机 高端装备 发布",
        "{month_cn} 智能工厂 工业AI 技术发布",
    ]},
]

URL_PATS = [
    re.compile(r"/(20\d{2})[-/_](\d{1,2})[-/_](\d{1,2})"),
    re.compile(r"(20\d{2})[-/_](\d{1,2})[-/_](\d{1,2})"),
]
CN_PAT = re.compile(r"(20\d{2})年(\d{1,2})月(\d{1,2})日")
ISO_PAT = re.compile(r"(20\d{2})[-/\.](\d{1,2})[-/\.](\d{1,2})")
NOISE_TITLE = re.compile(r"免责声明|证券研究报告|请仔细阅读本报告|投资评级说明|分析师声明|车网中国_倡导")
CHASSIS_POS = re.compile(r"底盘|线控|悬架|转向|制动|云辇|滑板底盘|底盘域|空气弹簧|CDC|EMB|SBW")
CHASSIS_NEG = re.compile(r"电动滑板车|滑板车|圈粉|南非")
IOV_POS = re.compile(r"车联网|网联|V2X|C-V2X|T-?Box|TBOX|车路|车云|高精地图|智能网联|车载通信|模组")


class AnysearchError(Exception):
    pass


def load_api_key() -> str:
    key = os.getenv("ANYSEARCH_API_KEY", "").strip()
    if key:
        return key
    mcp = Path.home() / ".cursor" / "mcp.json"
    if mcp.exists():
        try:
            data = json.loads(mcp.read_text(encoding="utf-8"))
            servers = data.get("mcpServers") or {}
            headers = (servers.get("anysearch") or servers.get("user-anysearch") or {}).get("headers") or {}
            auth = str(headers.get("Authorization") or "")
            if auth.lower().startswith("bearer "):
                return auth.split(" ", 1)[1].strip()
        except Exception:
            pass
    raise AnysearchError("缺少 ANYSEARCH_API_KEY 环境变量")


def date_labels(start: date, end: date) -> dict[str, str]:
    if start.year == end.year and start.month == end.month:
        range_cn = f"{start.year}年{start.month}月{start.day}日至{end.day}日"
        range_short = f"{start.year}年{start.month}月{start.day}-{end.day}日"
        month_cn = f"{start.year}年{start.month}月"
    else:
        range_cn = f"{start.year}年{start.month}月{start.day}日至{end.month}月{end.day}日"
        if start.year != end.year:
            range_cn = f"{start.year}年{start.month}月{start.day}日至{end.year}年{end.month}月{end.day}日"
        range_short = f"{start.year}年{start.month}月{start.day}日-{end.month}月{end.day}日"
        month_cn = f"{start.year}年{start.month}月至{end.month}月"
        if start.year != end.year:
            month_cn = f"{start.year}年{start.month}月至{end.year}年{end.month}月"
    return {"range_cn": range_cn, "range_short": range_short, "month_cn": month_cn}


def to_date(y, mo, d):
    try:
        y, mo, d = int(y), int(mo), int(d)
        if y < 100:
            y += 2000
        return date(y, mo, d)
    except Exception:
        return None


def parse_date(title: str, snippet: str, content: str, url: str):
    for pat in URL_PATS:
        m = pat.search(url or "")
        if m:
            dt = to_date(*m.groups()[-3:])
            if dt:
                return dt, "url"
    for pat in (CN_PAT, ISO_PAT):
        m = pat.search(title or "")
        if m:
            dt = to_date(*m.groups())
            if dt:
                return dt, "title"
    head = (snippet or "")[:240]
    for pat in (CN_PAT, ISO_PAT):
        m = pat.search(head)
        if m:
            dt = to_date(*m.groups())
            if dt:
                return dt, "snippet"
    headc = (content or "")[:300]
    for pat in (CN_PAT, ISO_PAT):
        m = pat.search(headc)
        if m:
            dt = to_date(*m.groups())
            if dt:
                return dt, "content_head"
    return None, ""


def relevant(topic: str, title: str, snippet: str) -> bool:
    text = f"{title} {snippet}"
    if topic == "汽车底盘":
        if CHASSIS_NEG.search(text):
            return False
        return bool(CHASSIS_POS.search(text))
    if topic == "车联网":
        return bool(IOV_POS.search(text))
    return True


def domain_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.replace("www.", "")
    except Exception:
        return ""


def normalize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")


def search_once(api_key: str, query: str, max_results: int = 50, retries: int = 3) -> dict:
    payload = json.dumps({"query": query, "max_results": max_results}).encode("utf-8")
    last_err = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "X-Anysearch-Client": "mcp/1.0.0",
                "User-Agent": "anysearch-industry-news/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if body.get("code") == 0:
                return body
            last_err = RuntimeError(body.get("message") or str(body)[:200])
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_err = exc
        time.sleep(1.5 * attempt)
    raise RuntimeError(f"search failed for {query!r}: {last_err}")


def flatten_result(topic_name, query, item, rank, window_start, window_end):
    title = (item.get("title") or "").strip()
    url = (item.get("url") or "").strip()
    snippet = (item.get("snippet") or "").strip()
    content = (item.get("content") or "").strip()
    if NOISE_TITLE.search(title):
        return None
    if not relevant(topic_name, title, snippet):
        return None
    dt, src = parse_date(title, snippet, content, url)
    in_window = ""
    if dt:
        in_window = "是" if window_start <= dt <= window_end else "否"
    return {
        "主题": topic_name,
        "检索query": query,
        "检索内排名": rank,
        "标题": title,
        "链接": url,
        "来源": domain_of(url),
        "解析日期": dt.isoformat() if dt else "",
        "日期来源": src,
        "是否窗口期内": in_window,
        "摘要": snippet[:800],
        "正文摘录": content[:1500],
        "_norm_url": normalize_url(url),
    }


def parse_day(s: str) -> date:
    return datetime.strptime(str(s).strip(), "%Y-%m-%d").date()


def run(params: dict) -> dict:
    start_raw = params.get("start")
    end_raw = params.get("end")
    if not start_raw or not end_raw:
        raise AnysearchError("必须提供 start 与 end（YYYY-MM-DD）")
    max_per_topic = int(params.get("max_per_topic", MAX_PER_TOPIC))
    export_dir = Path(params.get("export_dir") or "./workspace")

    start = parse_day(start_raw)
    end = parse_day(end_raw)
    if end < start:
        raise AnysearchError("end 不能早于 start")
    labels = date_labels(start, end)
    api_key = load_api_key()

    jobs: list[tuple[str, str]] = []
    for topic in TOPICS:
        for tmpl in topic["templates"]:
            jobs.append((topic["name"], tmpl.format(**labels)))

    rows: list[dict] = []
    total_jobs = len(jobs)
    done_jobs = 0
    print(f"开始检索：{len(TOPICS)} 个主题 / {total_jobs} 个查询，并发 {MAX_WORKERS}", file=sys.stderr, flush=True)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        fut_map = {pool.submit(search_once, api_key, q): (name, q) for name, q in jobs}
        for fut in as_completed(fut_map):
            name, q = fut_map[fut]
            done_jobs += 1
            print(f"检索进度 {done_jobs}/{total_jobs}（{name}）", file=sys.stderr, flush=True)
            try:
                body = fut.result()
                results = ((body.get("data") or {}).get("results")) or []
                for i, item in enumerate(results, 1):
                    row = flatten_result(name, q, item, i, start, end)
                    if row:
                        rows.append(row)
            except Exception:  # noqa: BLE001
                continue

    df = pd.DataFrame(rows)
    if df.empty:
        raise AnysearchError("未检索到任何结果")

    selected = []
    stats = []
    for topic in TOPICS:
        sub = df[df["主题"] == topic["name"]].copy()
        raw_n = len(sub)
        sub = sub[sub["_norm_url"] != ""]
        sub = sub.drop_duplicates(subset=["_norm_url"], keep="first")
        uniq_n = len(sub)

        def sort_key(row):
            flag = row["是否窗口期内"]
            pri = 0 if flag == "是" else (1 if flag == "否" else 2)
            return (pri, row["解析日期"] or "9999", row["检索内排名"])

        if not sub.empty:
            sub["_sort"] = sub.apply(sort_key, axis=1)
            sub = sub.sort_values("_sort").head(max_per_topic).copy()
            sub.insert(0, "序号", range(1, len(sub) + 1))
        selected.append(sub)
        stats.append({
            "主题": topic["name"],
            "检索query数": len(topic["templates"]),
            "原始条数": raw_n,
            "去重后条数": uniq_n,
            "导出条数": len(sub),
            "窗口期内": int((sub["是否窗口期内"] == "是").sum()) if not sub.empty else 0,
            "窗口期外/未知": int((sub["是否窗口期内"] != "是").sum()) if not sub.empty else 0,
        })

    non_empty = [s for s in selected if not s.empty]
    out = pd.concat(non_empty, ignore_index=True) if non_empty else pd.DataFrame()
    drop_cols = [c for c in out.columns if c.startswith("_")]
    if not out.empty:
        out = out.drop(columns=drop_cols)
        out["序号"] = range(1, len(out) + 1)
    stat_df = pd.DataFrame(stats)
    stat_df.loc[len(stat_df)] = {
        "主题": "合计",
        "检索query数": int(stat_df["检索query数"].sum()),
        "原始条数": int(stat_df["原始条数"].sum()),
        "去重后条数": int(stat_df["去重后条数"].sum()),
        "导出条数": int(stat_df["导出条数"].sum()),
        "窗口期内": int(stat_df["窗口期内"].sum()),
        "窗口期外/未知": int(stat_df["窗口期外/未知"].sum()),
    }

    note = pd.DataFrame([
        {"项": "时间窗口", "值": f"{start.isoformat()} 至 {end.isoformat()}"},
        {"项": "数据源", "值": API_URL},
        {"项": "导出时间", "值": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
        {"项": "说明", "值": "接口单次最多约20条，每主题5组变体检索后按链接去重，优先窗口期内，每主题最多50条。"},
    ])

    export_dir.mkdir(parents=True, exist_ok=True)
    out_path = (export_dir / f"中国产业新闻_{start:%Y%m%d}-{end:%m%d}.xlsx").resolve()
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        note.to_excel(writer, sheet_name="00_说明", index=False)
        stat_df.to_excel(writer, sheet_name="00_统计", index=False)
        (out if not out.empty else pd.DataFrame([{"提示": "无窗口期内结果"}])).to_excel(
            writer, sheet_name="00_合并结果", index=False
        )
        for topic, sub in zip(TOPICS, selected):
            sub_out = sub.drop(columns=[c for c in sub.columns if c.startswith("_")], errors="ignore")
            if sub_out.empty:
                sub_out = pd.DataFrame([{"提示": "无结果"}])
            sub_out.to_excel(writer, sheet_name=topic["sheet"], index=False)
        for ws in writer.book.worksheets:
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions

    return {
        "output_path": str(out_path),
        "window": f"{start.isoformat()}..{end.isoformat()}",
        "total_exported": int(len(out)),
        "stats": stats,
    }


def main() -> None:
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
        data = run(args if isinstance(args, dict) else {})
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    except AnysearchError as err:
        print(json.dumps({"ok": False, "error": str(err), "hint": "确认 start/end 与 ANYSEARCH_API_KEY 环境变量"}, ensure_ascii=False))
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
