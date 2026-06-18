【功能】: 将统计数据渲染为 ECharts 条形图配置（默认横向），支持 TopN 截断、主题样式、数值标签，返回 TopN 条目供后续抽样归因。本技能是纯计算工具，不取数；完整流程见 bar_chart_analysis 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/render_bar_chart.py "{\"data\": [{\"name\": \"爱玛\", \"value\": 1609}, {\"name\": \"雅迪\", \"value\": 760}], \"title\": \"TOP10组织分析\", \"subtitle\": \"爱玛电动车\", \"top_n\": 10}"
【参数说明】 (以 JSON 字符串形式传入):
  - data (必需): 对象数组，每条记录至少包含 name_field 和 value_field 指定的字段。若数据不全或为空，本技能会返回结构化错误并提示先取数。
  - name_field: 类目名称字段名，默认 "name"。名称必须是可读标签，禁止用原始 ID。
  - value_field: 数值字段名，默认 "value"。字段值为非负数（doc_count 或统计量）。
  - title: 主标题，默认 "TOP10 分析"。
  - subtitle: 副标题，默认空字符串。
  - top_n: 返回与渲染的 TopN 条目数量，默认 10。
  - orientation: 方向，"horizontal"（横向条形图）| "vertical"（纵向柱状图），默认 "horizontal"。
  - sort_order: 排序，"desc"（降序）| "asc"（升序），默认 "desc"。
  - show_value_label: 是否显示数值标签，默认 true。
  - unit: 数值显示单位后缀（如 "篇"、"次"），默认空。
  - theme: 样式主题，"default"（亮色）| "dark"（深色大屏），默认 "default"。
【返回格式】: JSON。成功: {"ok": true, "data": {"title","subtitle","theme","orientation","chart_block","top_items","stats"}}；失败: {"ok": false, "error", "hint"}。
  - chart_block: 完整前端渲染魔法码整串（以 CHART_OPTION_START 开头、CHART_OPTION_END 结尾）。**必须把这一整串原样复制到回复正文中**，前端会自动渲染图表，严禁手抄/重排/美化。
  - top_items: TopN 条目 [{"rank","name","value","percentage"}]，用于驱动后续条目抽样归因。

【示例 - TOP10 组织横向条形图】:
python skills/executor/render_bar_chart.py "{\"data\":[{\"name\":\"爱玛\",\"value\":1609},{\"name\":\"雅迪\",\"value\":760},{\"name\":\"爱玛黑翼\",\"value\":503},{\"name\":\"小牛\",\"value\":367}],\"title\":\"TOP10组织分析\",\"subtitle\":\"爱玛电动车\",\"orientation\":\"horizontal\",\"top_n\":10,\"theme\":\"default\"}"

【示例 - 标签分布纵向柱状图】:
python skills/executor/render_bar_chart.py "{\"data\":[{\"name\":\"智能化\",\"value\":1200},{\"name\":\"安全\",\"value\":980},{\"name\":\"续航\",\"value\":640}],\"orientation\":\"vertical\",\"title\":\"标签分布\",\"unit\":\"篇\"}"
