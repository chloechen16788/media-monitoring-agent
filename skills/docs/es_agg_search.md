【功能】: 查询宏观图表数据（如品牌声量、情感分布、各渠道趋势等）。通过分析结果回答关于“趋势解读”、“情绪洞察”、“渠道分布”等问题。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/es_agg_search.py "{\"task_ids\": [6860], \"start_time\": \"2026-04-24 00:00:00\", \"end_time\": \"2026-04-30 23:59:59\", \"dimensions\": [\"sov\", \"sentiment\"]}"
【参数说明】 (以 JSON 字符串形式传入):
  - uid (必需): 底层引擎的账户ID，由系统通知提供。
  - partition: 月份分区（YYYYMM，如 "202605"）。ES 按月分库，物理索引为 {uid}_{partition}，**必须与查询时间段同月**。缺省时自动按 start_time 的月份推导（推荐缺省）。跨月查询会被拒绝，请按月拆分为多次独立调用。个别特殊分区（如带 _fixed 后缀）才需要显式传入。
  - task_ids (必需): 品牌/任务的ID列表，例如 [6860] (Manus), [6861] (OpenAI), [6862] (Anthropic), [6863] (Google)。
  - start_time (必需): 开始时间，如 "2026-04-24 00:00:00"
  - end_time (必需): 结束时间，如 "2026-04-30 23:59:59"
 - dimensions (必需): 字符串数组，可填：
   ["sov", "trend", "channel", "sentiment", "sources", "effect_metrics", "trend_by_channel", "trend_by_sentiment", "prn_distribution", "named_entities", "keyword_freq", "category", "sub_category", "tag", "trend_by_category", "trend_by_tag"]，获取所需维度数据。
  - sentiment_filter (可选): 情感过滤数组，如 [-1]（仅负面）、[0,1]（仅正+中）。适用于所有维度，常用于“负面趋势线”场景。
  - entity_top_n (可选): 当 dimensions 含 `named_entities` 时，每种实体类型（PERSON/ORGANIZATION/LOCATION）返回的 TopN 数量，默认 10，最大 50。全局混合 Top 列表也会至少返回该数量（上限 20 与 entity_top_n 取较大值）。
【返回格式】: JSON 格式的数据统计结果。

【新增维度说明】:
  - trend_by_sentiment: 返回按天聚合、再按情感拆分的趋势结果。可直接用于绘制“正/中/负三条线”。
  - trend_by_channel: 返回按天聚合、再按渠道拆分的趋势结果（日期格式统一为 "yyyy-MM-dd"，便于与其他 trend 结果直接对齐）。
  - named_entities: NER 统计，返回每个 task 的实体总数 (`total_entities`)、唯一实体数 (`unique_entity_count`)、全局混合 Top 实体列表 (`top_entities`)，以及**按实体类型分组的 TopN** (`top_entities_by_type`)。该维度仅统计 `sentimentList.algorithm` 包含 `8` 的文档。
    - `top_entities_by_type` 键为规范化类型：`PERSON`（人名）、`ORGANIZATION`（机构，含 `ORGGANIZATION` 拼写变体）、`LOCATION`（地名）、`UNKNOWN`（空类型）。
    - 每项结构：`{entity_type, entity_type_label, items: [{entity_name, doc_count}]}`，可直接驱动 `render_bar_chart` 分别出三张图。
    - 示例取数：`dimensions: ["named_entities"], entity_top_n: 10`
  - keyword_freq: 词频统计，基于 `messageContentNLPFreq`（nested），返回关键词总出现次数、唯一关键词数、Top 关键词（按 `count` 求和排序）。
  - category: 分类占比，按 `catId` 聚合。该维度仅统计 `sentimentList.algorithm` 包含 `7` 的文档。
  - sub_category: 子分类占比，按 `subCatId` 聚合。该维度仅统计 `sentimentList.algorithm` 包含 `7` 的文档。
  - tag: 标签占比，按 `tagIdList` 聚合。该维度仅统计 `sentimentList.algorithm` 包含 `9` 的文档。
  - trend_by_category: 分类趋势，按天聚合后再按 `catId` 拆分（仅 `algorithm=7`）。
  - trend_by_tag: 标签趋势，按天聚合后再按 `tagIdList` 拆分（仅 `algorithm=9`）。
