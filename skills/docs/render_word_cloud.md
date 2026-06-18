【功能】: 将词频/实体统计数据渲染为 ECharts 词云图配置：按词频对数缩放字号、多色主题、支持 TopN 截断，返回 Top10 词条供抽样归因。本技能是纯计算工具，不取数；完整流程见 word_cloud_analysis 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/render_word_cloud.py "{\"data\": [{\"name\": \"人工智能\", \"value\": 1500}, {\"name\": \"大模型\", \"value\": 980}], \"title\": \"关键词云\", \"subtitle\": \"ManusAI 2026年6月\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - data (必需): 对象数组，每条记录至少包含 name_field 和 value_field 指定的字段。若数据不全或为空，本技能会返回结构化错误并提示先取数。
  - name_field: 词语名称字段名，默认 "name"。名称必须是可读标签，禁止用原始 ID。
  - value_field: 频次字段名，默认 "value"。字段值为正数（词频/doc_count 等）。
  - title: 主标题，默认 "词云"。
  - subtitle: 副标题，默认空字符串。
  - top_n: 词云最多展示的词条数量，默认 100，最大 500。词频越高字号越大。
  - top_items_n: 返回用于抽样的 Top N 词条数量，默认 10，与词云展示数量无关。
  - shape: 词云形状，支持 "circle"（圆形，默认）| "diamond"（菱形）| "pentagon"（五边形）| "star"（星形）| "triangle"（三角形）| "cardioid"（心形）。
  - min_font_size: 最小字号（px），默认 14。
  - max_font_size: 最大字号（px），默认 72。
  - theme: 样式主题，"default"（亮色）| "dark"（深色大屏），默认 "default"。
【返回格式】: JSON。成功: {"ok": true, "data": {"title","subtitle","theme","shape","chart_block","top_items","stats"}}；失败: {"ok": false, "error", "hint"}。
  - chart_block: 完整前端渲染魔法码整串（以 CHART_OPTION_START 开头、CHART_OPTION_END 结尾）。**必须把这一整串原样复制到回复正文中**，前端会自动渲染词云，严禁手抄/重排/美化。
  - top_items: 词频 Top N 词条 [{"rank","name","value","percentage"}]，用于驱动后续词条抽样归因。
  - stats: {"displayed_words","total_words","total_value","dropped_records"}

【示例 - 关键词词云（默认圆形）】:
python skills/executor/render_word_cloud.py "{\"data\":[{\"name\":\"人工智能\",\"value\":1500},{\"name\":\"大模型\",\"value\":980},{\"name\":\"机器人\",\"value\":760},{\"name\":\"自动驾驶\",\"value\":540}],\"title\":\"关键词云\",\"subtitle\":\"ManusAI 2026年6月\",\"top_n\":50,\"top_items_n\":10}"

【示例 - 实体词云（深色主题 + 星形）】:
python skills/executor/render_word_cloud.py "{\"data\":[{\"name\":\"中国\",\"value\":7834},{\"name\":\"Manus\",\"value\":3899},{\"name\":\"美国\",\"value\":2513}],\"title\":\"实体词云\",\"shape\":\"star\",\"theme\":\"dark\",\"top_items_n\":10}"

【示例 - 自定义字号范围】:
python skills/executor/render_word_cloud.py "{\"data\":[{\"name\":\"AI\",\"value\":5000},{\"name\":\"芯片\",\"value\":2000}],\"title\":\"热词分布\",\"min_font_size\":18,\"max_font_size\":60}"
