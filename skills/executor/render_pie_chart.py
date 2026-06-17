"""饼图/环形图渲染技能（A 类 / role=sub）。

纯计算工具：将分布类数据渲染为 ECharts 饼图（pie）或环形图（donut）配置，
内置主题样式，按占比降序返回 Top N 切片供后续分类抽样归因。不取数、不编排流程——
数据准备与切片归因的串联逻辑见 B 类说明书 pie_chart_analysis。

入参: argv[1] 单个 JSON 字符串（见 docs/render_pie_chart.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
"""

import sys
import json

THEMES = {
    "default": {
        "background": "#ffffff",
        "text": "#333333",
        "legend_text": "#4b5568",
        "tooltip_bg": "#ffffff",
        "palette": ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#f59e0b", "#14b8a6", "#f97316", "#06b6d4"],
    },
    "dark": {
        "background": "#0f1726",
        "text": "#dbe4f5",
        "legend_text": "#a0aec0",
        "tooltip_bg": "#1a2744",
        "palette": ["#5ab0ff", "#ff7849", "#34d399", "#c084fc", "#fbbf24", "#2dd4bf", "#fb923c", "#22d3ee"],
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


def build_option(title: str, pie_data: list, chart_type: str, theme: dict) -> dict:
    # 环形图通过 radius 数组实现：[内半径, 外半径]
    radius = ["40%", "65%"] if chart_type == "donut" else "55%"
    return {
        "backgroundColor": theme["background"],
        "title": {
            "text": title,
            "left": "center",
            "top": 10,
            "textStyle": {"color": theme["text"], "fontSize": 16},
        },
        "tooltip": {
            "trigger": "item",
            "formatter": "{b}: {c} ({d}%)",
            "backgroundColor": theme["tooltip_bg"],
            "textStyle": {"color": theme["text"]},
        },
        "legend": {
            "orient": "vertical",
            "left": "left",
            "top": "middle",
            "textStyle": {"color": theme["legend_text"]},
        },
        "color": theme["palette"],
        "series": [
            {
                "name": title,
                "type": "pie",
                "radius": radius,
                "center": ["58%", "55%"],
                "data": pie_data,
                "emphasis": {
                    "itemStyle": {
                        "shadowBlur": 10,
                        "shadowOffsetX": 0,
                        "shadowColor": "rgba(0, 0, 0, 0.3)",
                    }
                },
                "label": {
                    "color": theme["text"],
                    "formatter": "{b}\n{d}%",
                },
                "labelLine": {"lineStyle": {"color": theme["text"]}},
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
            " es_agg_search（dimensions 含 sentiment / channel / sov / sources）获取分布数据。",
        )

    name_field = str(params.get("name_field") or "name")
    value_field = str(params.get("value_field") or "value")

    chart_type = str(params.get("chart_type") or "pie").lower()
    if chart_type not in ("pie", "donut"):
        fail(f"chart_type 仅支持 \"pie\" 或 \"donut\"，收到 '{chart_type}'。")

    theme_key = str(params.get("theme") or "default")
    theme = THEMES.get(theme_key)
    if theme is None:
        fail(f"theme 仅支持 {sorted(THEMES)}，收到 '{theme_key}'。")

    try:
        top_n = int(params.get("top_slices") or 3)
    except (TypeError, ValueError):
        fail("top_slices 必须是整数。")
    top_n = max(1, top_n)

    title = str(params.get("title") or "分布占比")

    # 构建 ECharts pie data，过滤无效记录
    pie_data = []
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
        pie_data.append({"name": str(name), "value": round(val_num, 4)})
        total += val_num

    if not pie_data:
        fail(
            f"没有有效记录（name_field='{name_field}', value_field='{value_field}'）。",
            "请确认字段名与数据格式；若数据不全，请先调用 es_agg_search 取数。",
        )

    # 按 value 降序，大切片排前面
    pie_data.sort(key=lambda x: x["value"], reverse=True)

    # top_slices 返回给模型，用于驱动各切片的抽样归因命令
    top_slices = [
        {
            "name": item["name"],
            "value": item["value"],
            "percentage": round(item["value"] / total * 100, 1) if total > 0 else 0,
        }
        for item in pie_data[:top_n]
    ]

    option = build_option(title, pie_data, chart_type, theme)
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
            "chart_type": chart_type,
            "title": title,
            "theme": theme_key,
            "chart_block": chart_block,
            "top_slices": top_slices,
            "stats": {
                "total_slices": len(pie_data),
                "total_value": round(total, 4),
                "dropped_records": dropped,
            },
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
