"""Master-only planning skill: produce a chart plan for a given report type.

Input  : 报告类型字符串（argv[1]）或 JSON {"report_type": "..."}（argv[1] / stdin）
Output : JSON {"report_type", "charts": [...], "suggested_allowed_skills": [...], "acceptance_criteria": [...]}
角色   : role=master（仅供 Master 规划，基于 chart_render_schema.json 输出图表计划，不取数）
"""

import sys
import os
import json

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chart_render_schema.json")

# Sub 端执行报告所需的 executor 技能（写入 task_contract.allowed_skills）
DEFAULT_ALLOWED_SKILLS = ["es_agg_search", "es_sample_search", "advanced_chart_sampling"]


def read_report_type() -> str:
    raw = sys.argv[1] if len(sys.argv) >= 2 else sys.stdin.read()
    raw = (raw or "").strip()
    if not raw:
        return "brand_monthly"
    if raw.startswith("{"):
        try:
            obj = json.loads(raw)
            return str(obj.get("report_type") or obj.get("schema") or "brand_monthly")
        except json.JSONDecodeError:
            return raw
    return raw


def load_schema() -> dict:
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"schemas": {}}


def plan(report_type: str) -> dict:
    schema = load_schema().get("schemas", {})
    target = schema.get(report_type)
    if not target:
        return {
            "report_type": report_type,
            "error": f"unknown report_type '{report_type}'",
            "available": list(schema.keys()),
        }

    charts = []
    for chart_key, chart_def in (target.get("charts") or {}).items():
        charts.append({
            "chart_key": chart_key,
            "chart_type": chart_def.get("chartType"),
            "data_source": chart_def.get("dataSourceField"),
        })

    return {
        "report_type": report_type,
        "report_name": target.get("name", report_type),
        "charts": charts,
        "suggested_allowed_skills": DEFAULT_ALLOWED_SKILLS,
        "acceptance_criteria": [
            f"覆盖 {len(charts)} 个规划图表的洞察",
            "每个图表均有数据支撑且结论可溯源",
        ],
    }


if __name__ == "__main__":
    rt = read_report_type()
    print(json.dumps(plan(rt), ensure_ascii=False))
