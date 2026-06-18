"""词云渲染技能（A 类 / role=sub）。

纯计算工具：将词频/实体统计数据渲染为 ECharts 词云（wordCloud）配置，
按词频进行对数缩放字号、多色主题，返回 Top10 词条供后续抽样归因。
不取数、不编排流程——完整串联逻辑见 B 类说明书 word_cloud_analysis。

入参: argv[1] 单个 JSON 字符串（见 docs/render_word_cloud.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import json
import math
import sys

THEMES = {
    "default": {
        "background": "#ffffff",
        "text": "#333333",
        "subtitle": "#6b7280",
        "tooltip_bg": "#ffffff",
        "palette": [
            "#40a9d9", "#66d1b8", "#9da0d8", "#b4d89d",
            "#7ec9d8", "#d7a5cc", "#f1c40f", "#f58b6b",
            "#9bc85c", "#a8abb2", "#5ba4e5", "#e8836e",
            "#4dc9c0", "#c98ed4", "#7cb87a", "#e8a857",
        ],
    },
    "dark": {
        "background": "#0f1726",
        "text": "#dbe4f5",
        "subtitle": "#a0aec0",
        "tooltip_bg": "#1a2744",
        "palette": [
            "#5ab0ff", "#34d399", "#c084fc", "#9dd36f",
            "#2dd4bf", "#f472b6", "#fbbf24", "#fb923c",
            "#a3e635", "#94a3b8", "#60b0f0", "#e879f9",
            "#4ade80", "#f87171", "#38bdf8", "#facc15",
        ],
    },
}

VALID_SHAPES = ("circle", "diamond", "pentagon", "star", "triangle", "cardioid")


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


def log_scale_font(val: float, min_val: float, max_val: float,
                   min_size: int = 14, max_size: int = 72) -> int:
    """对数缩放：避免单个超高频词视觉上过度压制其他词。"""
    if max_val <= min_val:
        return (min_size + max_size) // 2
    log_v = math.log1p(max(0.0, val - min_val))
    log_max = math.log1p(max_val - min_val)
    ratio = log_v / log_max if log_max > 0 else 0.0
    return int(min_size + ratio * (max_size - min_size))


def build_option(
    title: str,
    subtitle: str,
    words: list[dict],
    shape: str,
    theme: dict,
    min_font: int,
    max_font: int,
) -> dict:
    palette = theme["palette"]
    vals = [w["value"] for w in words]
    min_val = min(vals)
    max_val = max(vals)

    series_data = [
        {
            "name": w["name"],
            "value": w["value"],
            "textStyle": {
                "color": palette[idx % len(palette)],
                "fontSize": log_scale_font(w["value"], min_val, max_val, min_font, max_font),
            },
        }
        for idx, w in enumerate(words)
    ]

    title_blocks = [
        {
            "text": title,
            "left": "left",
            "top": 8,
            "textStyle": {
                "color": theme["text"],
                "fontSize": 20,
                "fontWeight": "bold",
            },
        }
    ]
    if subtitle:
        title_blocks.append(
            {
                "text": subtitle,
                "left": "left",
                "top": 42,
                "textStyle": {
                    "color": theme["subtitle"],
                    "fontSize": 13,
                },
            }
        )

    grid_top = 80 if subtitle else 48

    return {
        "backgroundColor": theme["background"],
        "title": title_blocks,
        "tooltip": {
            "show": True,
            "formatter": "{b}: {c}",
            "backgroundColor": theme["tooltip_bg"],
            "textStyle": {"color": theme["text"]},
        },
        "series": [
            {
                "type": "wordCloud",
                "shape": shape,
                "left": "center",
                "top": grid_top,
                "width": "95%",
                "height": f"calc(95% - {grid_top}px)",
                "sizeRange": [min_font, max_font],
                "rotationRange": [0, 0],
                "rotationStep": 0,
                "gridSize": 10,
                "drawOutOfBound": False,
                "layoutAnimation": True,
                "emphasis": {
                    "focus": "self",
                    "textStyle": {
                        "shadowBlur": 12,
                        "shadowColor": "rgba(0,0,0,0.3)",
                    },
                },
                "data": series_data,
            }
        ],
    }


def main() -> None:
    params = read_params()

    data = params.get("data")
    if not isinstance(data, list) or len(data) == 0:
        fail(
            "缺少必要参数 data（非空对象数组）。",
            "每条记录需包含 name_field 和 value_field 字段；"
            "若尚未取数，请先调用 es_agg_search（dimensions 含 keyword_freq 或 named_entities）获取词频数据。",
        )

    name_field = str(params.get("name_field") or "name")
    value_field = str(params.get("value_field") or "value")
    title = str(params.get("title") or "词云")
    subtitle = str(params.get("subtitle") or "")
    shape = str(params.get("shape") or "circle").lower()
    if shape not in VALID_SHAPES:
        fail(f"shape 仅支持 {list(VALID_SHAPES)}，收到 '{shape}'。")
    theme_key = str(params.get("theme") or "default")
    theme = THEMES.get(theme_key)
    if theme is None:
        fail(f"theme 仅支持 {sorted(THEMES)}，收到 '{theme_key}'。")

    try:
        top_n = int(params.get("top_n") or 100)
    except (TypeError, ValueError):
        fail("top_n 必须是整数。")
    top_n = max(1, min(top_n, 500))

    try:
        top_items_n = int(params.get("top_items_n") or 10)
    except (TypeError, ValueError):
        fail("top_items_n 必须是整数。")
    top_items_n = max(1, top_items_n)

    try:
        min_font = int(params.get("min_font_size") or 14)
        max_font = int(params.get("max_font_size") or 72)
    except (TypeError, ValueError):
        fail("min_font_size / max_font_size 必须是整数。")
    if min_font >= max_font:
        fail(f"min_font_size({min_font}) 必须小于 max_font_size({max_font})。")

    # 解析并过滤记录
    valid_words: list[dict] = []
    dropped = 0
    total = 0.0
    for record in data:
        if not isinstance(record, dict):
            dropped += 1
            continue
        name = record.get(name_field)
        val = record.get(value_field)
        if name is None or val is None:
            dropped += 1
            continue
        try:
            val_num = float(val)
        except (TypeError, ValueError):
            dropped += 1
            continue
        if val_num <= 0:
            dropped += 1
            continue
        valid_words.append({"name": str(name), "value": round(val_num, 4)})
        total += val_num

    if not valid_words:
        fail(
            f"没有有效记录（name_field='{name_field}', value_field='{value_field}'）。",
            "请确认字段名与数据格式；若数据不全，请先调用 es_agg_search 取数。",
        )

    valid_words.sort(key=lambda x: x["value"], reverse=True)
    display_words = valid_words[:top_n]

    option = build_option(title, subtitle, display_words, shape, theme, min_font, max_font)

    top_items = [
        {
            "rank": idx + 1,
            "name": w["name"],
            "value": w["value"],
            "percentage": round(w["value"] / total * 100, 1) if total > 0 else 0,
        }
        for idx, w in enumerate(valid_words[:top_items_n])
    ]

    chart_block = (
        "[CHART_OPTION_START]"
        + json.dumps(option, ensure_ascii=False, separators=(",", ":"))
        + "[CHART_OPTION_END]"
    )

    result = {
        "ok": True,
        "data": {
            "title": title,
            "subtitle": subtitle,
            "theme": theme_key,
            "shape": shape,
            "chart_block": chart_block,
            "top_items": top_items,
            "stats": {
                "displayed_words": len(display_words),
                "total_words": len(valid_words),
                "total_value": round(total, 4),
                "dropped_records": dropped,
            },
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
