【功能】: 基于报告类型输出图表计划与建议的 allowed_skills，供写入 task_contract。仅供 Master 规划阶段使用，不取数。
【调用方式】: python skills/planner/plan_charts.py "<报告类型>"
  或 JSON: python skills/planner/plan_charts.py "{\"report_type\": \"brand_monthly\"}"
【返回格式】: JSON {"report_type", "report_name", "charts", "suggested_allowed_skills", "acceptance_criteria"}
