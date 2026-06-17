【功能】: 将分布类统计数据渲染为 ECharts 饼图或环形图配置，内置主题样式，按占比降序返回 Top N 切片供后续分类抽样归因。本技能是纯计算工具，不取数；数据准备与切片归因的完整流程见 pie_chart_analysis 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/render_pie_chart.py "{\"data\": [{\"name\": \"负面\", \"value\": 1200}, {\"name\": \"中性\", \"value\": 800}, {\"name\": \"正面\", \"value\": 300}], \"title\": \"情感分布\", \"chart_type\": \"donut\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - data (必需): 对象数组，每条记录至少包含 name_field 和 value_field 指定的字段。若数据不全或为空，本技能会返回结构化错误并提示先取数。
  - name_field: 切片名称字段名，默认 "name"。名称必须用中文可读标签（如 "负面"、"微博"），禁止用原始 ID。
  - value_field: 切片数值字段名，默认 "value"。字段值为正数（doc_count 或其他统计量）。
  - chart_type: 图表类型，"pie"（实心饼图）| "donut"（环形图），默认 "pie"。
  - title: 图表标题，默认 "分布占比"。
  - theme: 样式主题，"default"（亮色）| "dark"（深色大屏），默认 "default"。
  - top_slices: 返回用于抽样的 Top N 切片数量，默认 3。
【返回格式】: JSON。成功: {"ok": true, "data": {"chart_type", "title", "theme", "chart_block", "top_slices", "stats"}}；失败: {"ok": false, "error", "hint"}。
  - chart_block: 完整的前端渲染魔法码整串（以 CHART_OPTION_START 标记开头、CHART_OPTION_END 结尾）。**必须把这一整串原样复制到你的回复正文中**，前端会自动渲染图表。严禁手抄/重排/美化其中的 JSON。
  - top_slices: 按占比降序排列的 Top N 切片 [{"name", "value", "percentage"}]。用于驱动后续各切片的抽样归因命令。

【示例 - 情感分布环形图】:
python skills/executor/render_pie_chart.py "{\"data\":[{\"name\":\"负面\",\"value\":1200},{\"name\":\"中性\",\"value\":800},{\"name\":\"正面\",\"value\":300}],\"chart_type\":\"donut\",\"title\":\"情感分布\",\"theme\":\"default\"}"

【示例 - 渠道分布饼图】:
python skills/executor/render_pie_chart.py "{\"data\":[{\"name\":\"微博\",\"value\":5200},{\"name\":\"微信\",\"value\":3100},{\"name\":\"网媒资讯\",\"value\":2400},{\"name\":\"论坛\",\"value\":1800}],\"chart_type\":\"pie\",\"title\":\"渠道声量分布\",\"theme\":\"default\"}"
