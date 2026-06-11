【功能】: 查询宏观图表数据（如品牌声量、情感分布、各渠道趋势等）。通过分析结果回答关于“趋势解读”、“情绪洞察”、“渠道分布”等问题。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/es_agg_search.py "{\"task_ids\": [6860], \"start_time\": \"2026-04-24 00:00:00\", \"end_time\": \"2026-04-30 23:59:59\", \"dimensions\": [\"sov\", \"sentiment\"]}"
【参数说明】 (以 JSON 字符串形式传入):
  - uid (必需): 底层引擎的账户ID，由系统通知提供。
  - partition: 月份分区（YYYYMM，如 "202605"）。ES 按月分库，物理索引为 {uid}_{partition}，**必须与查询时间段同月**。缺省时自动按 start_time 的月份推导（推荐缺省）。跨月查询会被拒绝，请按月拆分为多次独立调用。个别特殊分区（如带 _fixed 后缀）才需要显式传入。
  - task_ids (必需): 品牌/任务的ID列表，例如 [6860] (Manus), [6861] (OpenAI), [6862] (Anthropic), [6863] (Google)。
  - start_time (必需): 开始时间，如 "2026-04-24 00:00:00"
  - end_time (必需): 结束时间，如 "2026-04-30 23:59:59"
  - dimensions (必需): 字符串数组，可填 ["sov", "trend", "channel", "sentiment", "sources", "effect_metrics", "trend_by_channel", "trend_by_sentiment", "prn_distribution"]，获取所需维度数据。
  - sentiment_filter (可选): 情感过滤数组，如 [-1]（仅负面）、[0,1]（仅正+中）。适用于所有维度，常用于“负面趋势线”场景。
【返回格式】: JSON 格式的数据统计结果。

【新增维度说明】:
  - trend_by_sentiment: 返回按天聚合、再按情感拆分的趋势结果。可直接用于绘制“正/中/负三条线”。
  - trend_by_channel: 返回按天聚合、再按渠道拆分的趋势结果（日期格式统一为 "yyyy-MM-dd"，便于与其他 trend 结果直接对齐）。
