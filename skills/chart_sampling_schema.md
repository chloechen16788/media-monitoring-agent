# 高级图表抽样规范指南 (Advanced Chart Sampling Schema)

这是一份关于“图表下钻分析”和“微观抽样”的标准操作规范（SOP）。
当用户要求解读大屏上某一类图表（如：宏观汇总、情感占比、趋势图、意见领袖等）时，你必须严格遵循本指南中的抽样策略，并按照指定的 JSON 结构输出。

## 注意：你的可用工具
你手上**唯一**可用的物理抽样工具是 `es_sample_search.py`，它只能接受基本的时间段、关键词和情感过滤。
**因此，对于复杂的抽样逻辑（如“每时间段每组抽1篇”），你必须在脑海中自行切分时间段或查询条件，通过 `shell` 工具在一个指令流中连续多次调用 `es_sample_search.py`（例如使用 bash for 循环或多次分发），然后整合返回结果！**

---

## 1. 抽样方法规则与对应输出

根据用户要分析的图表类型，定位 `sampling_key` 并应用以下规则：

| `sampling_key` | 适配图表 | 取样逻辑指导（你需在调用工具时手动实现此逻辑） | 预期必须收集的数据元素 |
|---|---|---|---|
| `summary_top_risks` | 数据汇总 | 优先从负面维度(negative)抽取代表文章，若无负面则抽取TopN。图表数据取前3。 | `risk_highlights[]`, `overview_items[]` |
| `sentiment_cluster_topn` | 情感占比 | 针对每个情感分项（正面/负面/中性），分别调用工具，每组强制抽取2篇 (size=2) 代表文。 | `highlights[]` |
| `dimension_topn` | 各类占比分布 (媒体、原创等) | 针对大屏显示的每一个主要分布类别，分别调用工具，每组抽取2篇。 | `highlights[]` |
| `source_topn` | 热点媒体/媒体号 | 针对大屏Top媒体，结合媒体名称作为 `keywords` 调用抽样，每媒体抽取2篇。 | `highlights[]` |
| `leader_top_posts` | 意见领袖 | 针对领袖名称/观点，分别调用抽样，抽取高影响力文章。 | `highlights[]` |
| `trend_peak_events` | 情感趋势 | **时间分段抽样**：识别趋势图中的波峰和波谷。针对每个重要时间段（如某日），分别按情感分组进行调用抽样（即每段每组取1篇代表文）。 | `trend_points[]`, `highlights[]` |
| `trend_by_media_type`| 渠道趋势 | 同上，但按时间段+渠道(keywords)进行交叉调用抽样。 | `trend_points[]`, `highlights[]` |
| `ner_top_entities` | TOP10实体 | 从图表读取Top5实体，针对每个实体名字作为 keyword，各抽1篇代表文。 | `top_items[]`, `highlights[]` |
| `wordcloud_top_terms`| 词云/话题/emoji | 提取词云中的Top5高频词，作为 keyword，分别抽取1篇代表文。 | `top_items[]`, `highlights[]` |

---

## 2. 抽样上下文输出结构 (Strict JSON Contract)

无论你查阅了多少次底层脚本，在总结汇报给用户或系统时，**必须**输出以下纯 JSON 结构作为最终结果表达你的分析结论：

```json
{
  "sampling_key": "<例如: trend_peak_events>",
  "meta": {
    "entity_limit": 5,
    "group_article_limit": 2,
    "source_priority": "segments_first"
  },
  "trend_points": [
    { "name": "2026-03-06", "count": 320, "ratio": null }
  ],
  "top_items": [
    { "name": "Manus", "count": 1790, "ratio": null }
  ],
  "highlights": [
    {
      "dimension": "<如: negative / 微博 / 某个具体实体名>",
      "segment_id": 2,
      "segment_start_time": "2026-03-06 00:00:00",
      "segment_end_time": "2026-03-06 23:59:59",
      "finger": "<原文指纹>",
      "cluster_count": 12,
      "avg_prn": 85,
      "message_title": "<文章标题>",
      "media_name": "<媒体名称>",
      "message_time": "<发布时间>",
      "message_url": "<链接>",
      "blurb": "<原文摘要/内容>",
      "prn": 90
    }
  ],
  "risk_highlights": [],
  "overview_items": [],
  "warnings": []
}
```

**【终极指令】**：
1. 不要试图寻找名为 `advanced_chart_sample.py` 的脚本！它不存在！这个 Schema 是你大脑的**逻辑思维导图**。你必须利用自己强大的任务分解能力，把这些复杂的规则，通过多次组合调用基础的 `es_sample_search.py` 来实现。拼装成功后输出该 JSON！
2. **绝对禁止盲猜**：如果用户在问题中**没有明确指定**要分析哪一种大屏图表（例如用户只发了 `帮我按规范抽样分析一下大屏图表：`，冒号后面是空的），你**绝对不能**擅自做主挑选某个图表（如趋势折线图）来分析！你必须停止执行任何动作，并直接反问用户：'请问您具体想深挖大屏上的哪一个图表？（例如：趋势图、情感占比图、各类分布图等）'
