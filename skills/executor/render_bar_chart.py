"""条形图渲染技能（A 类 / role=sub）。

纯计算工具：将分布类数据渲染为 ECharts 条形图配置（默认横向），
支持 TopN 截断、主题样式、数值标签，返回 TopN 条目供后续抽样归因。
不取数、不编排流程——完整串联逻辑见 B 类说明书 bar_chart_analysis。

入参: argv[1] 单个 JSON 字符串（见 docs/render_bar_chart.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import json
import sys

THEMES = {
    "default": {
        "background": "#ffffff",
        "text": "#333333",
        "axis": "#6b7280",
        "grid": "#d7dce6",
        "tooltip_bg": "#ffffff",
        "palette": [
            "#40a9d9",
            "#66d1b8",
            "#9da0d8",
            "#b4d89d",
            "#7ec9d8",
            "#d7a5cc",
            "#f1c40f",
            "#f58b6b",
            "#9bc85c",
            "#a8abb2",
        ],
    },
    "dark": {
        "background": "#0f1726",
        "text": "#dbe4f5",
        "axis": "#a0aec0",
        "grid": "#32445f",
        "tooltip_bg": "#1a2744",
        "palette": [
            "#5ab0ff",
            "#34d399",
            "#c084fc",
            "#9dd36f",
            "#2dd4bf",
            "#f472b6",
            "#fbbf24",
            "#fb923c",
            "#a3e635",
            "#94a3b8",
        ],
    },
}


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


def comma_format(v: float) -> str:
    if abs(v - int(v)) < 1e-8:
        return f"{int(v):,}"
    return f"{v:,.2f}"


def bar_layout(orientation: str, item_count: int) -> dict:
    """条形占类目带宽的比例；留足上下/左右间距，条目少时限制最大厚度。
    横向条形图：前端按 item_count * 44 + 160 动态拉高，barWidth 百分比自适应。
    barMaxWidth 用于条目少（Top3~5）时避免条过粗。
    """
    if orientation == "horizontal":
        width_pct = "46%"
        max_width = 22 if item_count <= 5 else 28
    else:
        width_pct = "50%"
        max_width = 24 if item_count <= 5 else 30
    return {"barWidth": width_pct, "barMaxWidth": max_width}


def build_option(
    title: str,
    subtitle: str,
    items: list[dict],
    orientation: str,
    show_value_label: bool,
    unit: str,
    theme: dict,
) -> dict:
    names = [x["name"] for x in items]
    value_data = [
        {
            "value": x["value"],
            "itemStyle": {"color": theme["palette"][idx % len(theme["palette"])]},
        }
        for idx, x in enumerate(items)
    ]
    value_label_suffix = unit if unit else ""

    if orientation == "vertical":
        x_axis = {
            "type": "category",
            "data": names,
            "axisLabel": {"color": theme["axis"], "interval": 0, "rotate": 20},
            "axisLine": {"lineStyle": {"color": theme["grid"]}},
        }
        y_axis = {
            "type": "value",
            "axisLabel": {"color": theme["axis"], "formatter": "{value}"},
            "splitLine": {"lineStyle": {"color": theme["grid"]}},
        }
    else:
        x_axis = {
            "type": "value",
            "axisLabel": {"color": theme["axis"], "formatter": "{value}"},
            "splitLine": {"lineStyle": {"color": theme["grid"]}},
        }
        y_axis = {
            "type": "category",
            "data": names,
            "inverse": True,
            "axisLabel": {"color": theme["axis"], "interval": 0, "margin": 14},
            "axisTick": {"show": False},
            "axisLine": {"show": False},
        }

    return {
        "backgroundColor": theme["background"],
        "title": [
            {
                "text": title,
                "left": "left",
                "top": 8,
                "textStyle": {"color": theme["text"], "fontSize": 22, "fontWeight": "bold"},
            },
            {
                "text": subtitle,
                "left": "left",
                "top": 52,
                "textStyle": {"color": theme["axis"], "fontSize": 14, "fontWeight": "bold"},
            },
        ],
        "tooltip": {
            "trigger": "axis",
            "axisPointer": {"type": "shadow"},
            "backgroundColor": theme["tooltip_bg"],
            "textStyle": {"color": theme["text"]},
        },
        "grid": {
            "left": "22%" if orientation == "horizontal" else "8%",
            "right": "10%" if orientation == "horizontal" else "8%",
            "top": 120,
            "bottom": 48 if orientation == "horizontal" else 70,
            "containLabel": True,
        },
        "xAxis": x_axis,
        "yAxis": y_axis,
        "series": [
            {
                "type": "bar",
                "data": value_data,
                **bar_layout(orientation, len(items)),
                "label": {
                    "show": show_value_label,
                    "position": "right" if orientation == "horizontal" else "top",
                    "distance": 6,
                    "color": theme["text"],
                    "formatter": "{c}" + value_label_suffix,
                },
            }
        ],
    }


def main() -> None:
    params = read_params()
    data = params.get("data")
    if not isinstance(data, list) or len(data) == 0:
        fail(
            "缺少必要参数 data（非空对象数组）。",
            "每条记录需包含 name_field 和 value_field 字段；若尚未取数，请先调用"
            " es_agg_search 获取分布类统计数据。",
        )

    name_field = str(params.get("name_field") or "name")
    value_field = str(params.get("value_field") or "value")
    orientation = str(params.get("orientation") or "horizontal").lower()
    if orientation not in ("horizontal", "vertical"):
        fail(f"orientation 仅支持 \"horizontal\" 或 \"vertical\"，收到 '{orientation}'。")
    theme_key = str(params.get("theme") or "default")
    theme = THEMES.get(theme_key)
    if theme is None:
        fail(f"theme 仅支持 {sorted(THEMES)}，收到 '{theme_key}'。")
    sort_order = str(params.get("sort_order") or "desc").lower()
    if sort_order not in ("desc", "asc"):
        fail(f"sort_order 仅支持 \"desc\" 或 \"asc\"，收到 '{sort_order}'。")
    title = str(params.get("title") or "TOP10 分析")
    subtitle = str(params.get("subtitle") or "")
    unit = str(params.get("unit") or "")
    show_value_label = bool(params.get("show_value_label", True))
    try:
        top_n = int(params.get("top_n") or 10)
    except (TypeError, ValueError):
        fail("top_n 必须是整数。")
    top_n = max(1, top_n)

    valid_items = []
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
        if val_num < 0:
            dropped += 1
            continue
        valid_items.append({"name": str(name), "value": round(val_num, 4)})
        total += val_num

    if not valid_items:
        fail(
            f"没有有效记录（name_field='{name_field}', value_field='{value_field}'）。",
            "请确认字段名与数据格式；若数据不全，请先调用 es_agg_search 取数。",
        )

    valid_items.sort(key=lambda x: x["value"], reverse=(sort_order == "desc"))
    top_items = valid_items[:top_n]
    option = build_option(title, subtitle, top_items, orientation, show_value_label, unit, theme)

    top_items_with_rank = [
        {
            "rank": idx + 1,
            "name": item["name"],
            "value": item["value"],
            "percentage": round(item["value"] / total * 100, 1) if total > 0 else 0,
        }
        for idx, item in enumerate(top_items)
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
            "orientation": orientation,
            "chart_block": chart_block,
            "top_items": top_items_with_rank,
            "stats": {
                "returned_items": len(top_items),
                "total_items": len(valid_items),
                "total_value": round(total, 4),
                "dropped_records": dropped,
            },
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
