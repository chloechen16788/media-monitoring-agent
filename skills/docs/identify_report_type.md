【功能】: 根据用户意图文本识别报告类型（brand_monthly / competitor_weekly）。仅供 Master 规划阶段使用，不触发执行引擎。
【调用方式】: python skills/planner/identify_report_type.py "<用户意图文本>"
  或 JSON: python skills/planner/identify_report_type.py "{\"text\": \"我想要竞品周报\"}"
【返回格式】: JSON {"report_type", "confidence", "reason", "candidates"}
