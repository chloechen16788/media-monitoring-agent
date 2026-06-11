"""折线图渲染技能（A 类 / role=sub）。

纯计算工具：将时间序列数据聚合为 ECharts 折线图配置（横轴时间、纵轴数量加总），
内置主题样式，标注并返回 Top N 峰值点供后续抽样归因。不取数、不编排流程——
数据准备与峰值归因的串联逻辑见 B 类说明书 line_chart_analysis。

入参: argv[1] 单个 JSON 字符串（见 docs/render_line_chart.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import sys
import json
from datetime import datetime

THEMES = {
    "default": {
        "background": "#ffffff",
        "text": "#333333",
        "axis_line": "#d0d4dc",
        "split_line": "#eef1f6",
        "line": "#3b82f6",
        "area_top": "rgba(59, 130, 246, 0.25)",
        "area_bottom": "rgba(59, 130, 246, 0.02)",
        "peak": "#ef4444",
        "palette": ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#f59e0b", "#14b8a6"],
    },
    "dark": {
        "background": "#0f1726",
        "text": "#dbe4f5",
        "axis_line": "#2a3a55",
        "split_line": "#1c2940",
        "line": "#5ab0ff",
        "area_top": "rgba(90, 176, 255, 0.30)",
        "area_bottom": "rgba(90, 176, 255, 0.03)",
        "peak": "#ff7849",
        "palette": ["#5ab0ff", "#ff7849", "#34d399", "#c084fc", "#fbbf24", "#2dd4bf"],
    },
}

GRANULARITY_FORMAT = {
    "hour": "%Y-%m-%d %H:00",
    "day": "%Y-%m-%d",
    "month": "%Y-%m",
}

TIME_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d",
]


def fail(error: str, hint: str = "") -> None:
    payload = {"ok": False, "error": error}
    if hint:
        payload["hint"] = hint
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def read_params() -> dict:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        fail("参数必须是单个合法的 JSON 字符串（禁止单引号）。")
    if not isinstance(parsed, dict):
        fail("参数 JSON 必须是对象。")
    return parsed


def parse_time(value) -> datetime | None:
    text = str(value).strip()
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def build_option(
    title: str,
    x: list,
    series_items: list,
    mark_series_name: str,
    mark_peaks: list,
    theme: dict,
    value_name: str,
    show_area: bool,
) -> dict:
    series_payload = []
    for item in series_items:
        entry = {
            "name": item["name"],
            "type": "line",
            "data": item["data"],
            "smooth": True,
            "symbolSize": 6,
            "lineStyle": {"width": 3, "color": item["color"]},
            "itemStyle": {"color": item["color"]},
        }
        if show_area:
            entry["areaStyle"] = {
                "color": {
                    "type": "linear",
                    "x": 0, "y": 0, "x2": 0, "y2": 1,
                    "colorStops": [
                        {"offset": 0, "color": theme["area_top"]},
                        {"offset": 1, "color": theme["area_bottom"]},
                    ],
                }
            }
        if item["name"] == mark_series_name and mark_peaks:
            entry["markPoint"] = {
                "itemStyle": {"color": theme["peak"]},
                "label": {"color": "#ffffff"},
                "data": [
                    {"name": "峰值", "coord": [p["time"], p["value"]], "value": p["value"]}
                    for p in mark_peaks
                ],
            }
        series_payload.append(entry)

    option = {
        "backgroundColor": theme["background"],
        "title": {
            "text": title,
            "left": "center",
            "textStyle": {"color": theme["text"], "fontSize": 16},
        },
        "tooltip": {"trigger": "axis"},
        "grid": {"left": 48, "right": 24, "top": 56, "bottom": 40},
        "xAxis": {
            "type": "category",
            "name": "时间",
            "data": x,
            "axisLine": {"lineStyle": {"color": theme["axis_line"]}},
            "axisLabel": {"color": theme["text"]},
        },
        "yAxis": {
            "type": "value",
            "name": value_name,
            "axisLine": {"lineStyle": {"color": theme["axis_line"]}},
            "axisLabel": {"color": theme["text"]},
            "splitLine": {"lineStyle": {"color": theme["split_line"]}},
        },
        "series": series_payload,
    }
    if len(series_items) > 1:
        option["legend"] = {
            "top": 28,
            "textStyle": {"color": theme["text"]},
            "data": [item["name"] for item in series_items],
        }
    return option


def main() -> None:
    params = read_params()

    data = params.get("data")
    if not isinstance(data, list) or len(data) == 0:
        fail(
            "缺少必要参数 data（非空对象数组）。",
            "若尚未取数，请按 line_chart_analysis 说明书先调用 es_agg_search（dimensions 含 \"trend\"）获取时间趋势数据。",
        )

    time_field = str(params.get("time_field") or "time")
    value_field = params.get("value_field")
    series_field = params.get("series_field")
    peak_series = str(params.get("peak_series") or "").strip()
    granularity = str(params.get("granularity") or "day")
    if granularity not in GRANULARITY_FORMAT:
        fail(f"granularity 仅支持 {sorted(GRANULARITY_FORMAT)}，收到 '{granularity}'。")

    theme_key = str(params.get("theme") or "default")
    theme = THEMES.get(theme_key)
    if theme is None:
        fail(f"theme 仅支持 {sorted(THEMES)}，收到 '{theme_key}'。")

    try:
        top_peaks = int(params.get("top_peaks") or 3)
    except (TypeError, ValueError):
        fail("top_peaks 必须是整数。")
    top_peaks = max(1, top_peaks)

    bucket_fmt = GRANULARITY_FORMAT[granularity]
    dropped = 0
    series_buckets: dict = {}
    if series_field:
        for record in data:
            if not isinstance(record, dict) or time_field not in record or series_field not in record:
                dropped += 1
                continue
            moment = parse_time(record[time_field])
            if moment is None:
                dropped += 1
                continue
            series_name = str(record.get(series_field) or "").strip()
            if not series_name:
                dropped += 1
                continue
            if value_field is not None:
                try:
                    amount = float(record.get(value_field))
                except (TypeError, ValueError):
                    dropped += 1
                    continue
            else:
                amount = 1
            key = moment.strftime(bucket_fmt)
            series_buckets.setdefault(series_name, {})
            series_buckets[series_name][key] = series_buckets[series_name].get(key, 0) + amount
    else:
        single_buckets: dict = {}
        for record in data:
            if not isinstance(record, dict) or time_field not in record:
                dropped += 1
                continue
            moment = parse_time(record[time_field])
            if moment is None:
                dropped += 1
                continue
            if value_field is not None:
                try:
                    amount = float(record.get(value_field))
                except (TypeError, ValueError):
                    dropped += 1
                    continue
            else:
                amount = 1
            key = moment.strftime(bucket_fmt)
            single_buckets[key] = single_buckets.get(key, 0) + amount
        if single_buckets:
            series_buckets["数据条数" if value_field is None else str(value_field)] = single_buckets

    if not series_buckets:
        fail(
            f"没有任何记录能按 time_field='{time_field}' 解析出有效时间。",
            "请确认时间字段名与格式；多线模式需提供 series_field 且每条记录具备该字段。",
        )

    all_time_keys = set()
    for bucket_map in series_buckets.values():
        all_time_keys.update(bucket_map.keys())
    x = sorted(all_time_keys)

    palette = theme.get("palette") or [theme["line"]]
    series_items = []
    peaks_by_series = {}
    for idx, (series_name, bucket_map) in enumerate(series_buckets.items()):
        y = [round(bucket_map.get(k, 0), 4) for k in x]
        peaks = sorted(
            ({"time": k, "value": round(bucket_map.get(k, 0), 4)} for k in x),
            key=lambda p: p["value"],
            reverse=True,
        )[:top_peaks]
        peaks_by_series[series_name] = peaks
        series_items.append({
            "name": series_name,
            "data": y,
            "color": palette[idx % len(palette)],
        })

    mark_series_name = peak_series if peak_series in peaks_by_series else series_items[0]["name"]
    mark_peaks = peaks_by_series.get(mark_series_name, [])

    title = str(params.get("title") or "时间趋势折线图")
    value_name = str(value_field) if value_field else "数据条数"

    option = build_option(
        title=title,
        x=x,
        series_items=series_items,
        mark_series_name=mark_series_name,
        mark_peaks=mark_peaks,
        theme=theme,
        value_name=value_name,
        show_area=len(series_items) == 1,
    )
    # chart_block 是给前端的完整魔法码整串：模型必须原样复制到回复中，
    # 禁止重排/美化/手抄 JSON——手抄会引入语法错误导致前端渲染失败。
    chart_block = (
        "[CHART_OPTION_START]"
        + json.dumps(option, ensure_ascii=False, separators=(",", ":"))
        + "[CHART_OPTION_END]"
    )

    result = {
        "ok": True,
        "data": {
            "chart_type": "line",
            "title": title,
            "theme": theme_key,
            "granularity": granularity,
            "series_count": len(series_items),
            "mark_peak_series": mark_series_name,
            "chart_block": chart_block,
            "peaks": peaks_by_series if len(series_items) > 1 else mark_peaks,
            "stats": {
                "points": len(x),
                "total": round(sum(sum(item["data"]) for item in series_items), 4),
                "max": max((max(item["data"]) for item in series_items), default=0),
                "min": min((min(item["data"]) for item in series_items), default=0),
                "dropped_records": dropped,
            },
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
