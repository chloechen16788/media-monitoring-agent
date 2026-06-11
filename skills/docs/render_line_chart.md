【功能】: 将时间序列数据聚合渲染为 ECharts 折线图配置（横轴=时间，纵轴=数量加总或指定数值字段加总），内置主题样式，自动标注并返回 Top N 峰值日期供后续抽样归因。本技能是纯计算工具，不取数；数据准备与峰值归因的完整流程见 line_chart_analysis 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/render_line_chart.py "{\"data\": [{\"time\": \"2026-04-01\", \"value\": 120}, {\"time\": \"2026-04-02\", \"value\": 80}], \"value_field\": \"value\", \"title\": \"声量趋势\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - data (必需): 对象数组，每条记录至少包含一个时间字段。可以是逐条舆情记录（含发布时间/来源/作者/标题/摘要/链接），也可以是已聚合的趋势点。数据不全或为空时本技能会返回结构化错误并提示先取数。
  - time_field: 时间字段名，默认 "time"。支持 "YYYY-MM-DD"、"YYYY-MM-DD HH:MM:SS"、"YYYY/MM/DD" 等常见格式，无法解析的记录会被跳过并计入 dropped_records。
  - value_field: 可选。数值字段名，按该字段在每个时间桶内求和；不传则按记录条数计数（即"一共有多少条数据"）。
  - granularity: 时间聚合粒度，"hour" | "day" | "month"，默认 "day"。
  - title: 图表标题，默认 "时间趋势折线图"。
  - theme: 样式主题，"default"（亮色）| "dark"（深色大屏），默认 "default"。新增主题须在脚本 THEMES 字典中登记预设并同步更新本说明书，调用接口不变。
  - top_peaks: 返回的峰值数量，默认 3。
【返回格式】: JSON。成功: {"ok": true, "data": {"chart_block", "peaks", "stats", ...}}；失败: {"ok": false, "error", "hint"}。
  - chart_block: 完整的前端渲染魔法码整串（以 CHART_OPTION_START 标记开头、CHART_OPTION_END 标记结尾）。**必须把这一整串原样复制到你的回复正文中**，前端会自动渲染折线图。严禁手抄/重排/美化其中的 JSON——任何改写都可能引入语法错误导致渲染失败。
  - peaks: 按数值降序的峰值点数组 [{"time", "value"}]，用于驱动 es_sample_search 峰值日期抽样。
  - stats: {points, total, max, min, dropped_records} 统计摘要。
