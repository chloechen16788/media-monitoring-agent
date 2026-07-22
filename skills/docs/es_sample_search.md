【功能】: 抽取微观热门文章样本。当你需要分析具体的爆发点、爆款文章内容、或提炼负面事件时调用。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/es_sample_search.py "{\"task_ids\": [6860], \"start_time\": \"2026-04-24 00:00:00\", \"end_time\": \"2026-04-30 23:59:59\", \"size\": 10}"
【参数说明】 (以 JSON 字符串形式传入):
  - uid (必需): 底层引擎的账户ID，由系统通知提供。
  - partition: 月份分区（YYYYMM，如 "202605"）。ES 按月分库，物理索引为 {uid}_{partition}，**必须与查询时间段同月**。缺省时自动按 start_time 的月份推导（推荐缺省）。跨月查询会被拒绝，请按月拆分为多次独立调用。个别特殊分区（如带 _fixed 后缀）才需要显式传入。
  - task_ids (必需): 品牌/任务的ID列表，例如 [6860] (Manus)。
  - start_time (必需): 开始时间。
  - end_time (必需): 结束时间。
  - size: 提取的文章数量，默认为 20。
  - keywords: 可选。用于过滤特定关键词的文章。
  - sentiment_filter: 可选。传入 -1 获取纯负面，0 获取纯正面，1 获取纯中性。用于情感分布饼图切片归因抽样。
  - channel_filter: 可选。传入渠道 ID（整数或数组），用于渠道切片归因抽样。兼容星光与清博编码，例如 108（微博）、[106, 108]（论坛+微博）、4（微博）、[2,4]（论坛+微博）。
  - content_max_chars: 可选。正文 content_snippet 截断上限，默认 1500（图表归因场景保持不变）。标注取数流程建议传 2000；传 0 表示不截断（返回全文）。
  - output_jsonl: 可选。若传入则把结果写入该 JSONL 路径（每行一条），用于大批量链路传递，避免工具消息体过大。
  - include_articles: 可选。是否在 stdout 返回 articles。默认规则：未传 output_jsonl 时返回；传了 output_jsonl 时默认不返回（可显式设 true 覆盖）。
【返回格式】: 包含原文片段、媒体来源和渠道字段的热门文章 JSON 列表。`articles` 每条含：
  - taskId / title / url / author / media / time
  - dataChannel: ES 原始渠道 ID
  - channel_source_name: 渠道名称（按星光+清博映射自动解析）
  - blurb: ES 返回的摘要字段（若无则空）
  - fingerprint_cluster_size / content_snippet
  - 若传 output_jsonl，还会返回 file_path（绝对路径）与 output_jsonl（原始入参路径）。
