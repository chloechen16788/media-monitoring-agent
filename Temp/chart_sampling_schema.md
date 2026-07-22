# 高级图表抽样规范指南 (Advanced Chart Sampling Schema)

这是一份关于“图表下钻分析”和“微观抽样”的标准操作规范（SOP）。
当用户要求解读大屏上某一类图表（如：宏观汇总、情感占比、趋势图、意见领袖等）时，你必须严格遵循本指南中的抽样策略，并按照指定的 JSON 结构输出。

## 注意：你的可用工具
你手上**唯一**可用的物理抽样工具是 `es_sample_search.py`，它只能接受基本的时间段、关键词和情感过滤。
**因此，对于复杂的抽样逻辑（如“每时间段每组抽1篇”），你必须在脑海中自行切分时间段或查询条件，然后“逐次发起多条独立的 python 命令”分别调用 `es_sample_search.py`（每条命令形如 `["python", "skills/executor/es_sample_search.py", "<JSON参数>"]`），最后整合所有返回结果！**

**【沙箱限制警告】**：企业沙箱只放行单条 `python skills/*.py` 命令。**绝对禁止**使用 bash for 循环、管道（`|`）、命令串联（`&&`/`;`）或 `bash -c`——这些一律会被拦截并返回 Permission Denied。需要 N 次抽样，就老老实实发 N 条独立命令。

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

## 2. 抽样上下文输出结构 (Strict XML Contract)

你**必须**使用特定的 XML 标签将你的分析结论“投射”到前端大屏相应的插槽中。绝对不要输出 JSON！
**为了提高响应速度，请保持每个插槽的分析字数精简（不超过 100-150 字）。**

你需要使用以下格式：
```xml
<UPDATE_INSIGHT target="{entityKey}_{sampling_key}">
### 这里是你的深度分析标题
这里是你基于抽样数据生成的详细洞察文本。可以使用 Markdown 语法进行排版。
1. **核心发现**：...
2. **趋势解读**：...
</UPDATE_INSIGHT>
```

**【Target 拼接规则说明】**：
`target` 的值必须是由 `{entityKey}_{sampling_key}` 组成的字符串，缺一不可！
*   **`entityKey`**: 分析视角。通常是 `brand` (本品/主品牌), `competitor` (竞品), `product` (产品), 或 `leader` (领导人)。(例如分析Manus，就是 `brand`)。
*   **`sampling_key`**: 本指南第 1 节中表格里的键名 (如 `leader_top_posts`, `trend_peak_events` 等)。
*   **示例**: 如果你在分析本品 (brand) 的意见领袖观点 (leader_top_posts)，那么 `<UPDATE_INSIGHT target="brand_leader_top_posts">`。

**【终极指令】**：
1. 不要试图寻找名为 `advanced_chart_sample.py` 的脚本！它不存在！这个 Schema 是你大脑的**逻辑思维导图**。你必须利用自己强大的任务分解能力，把这些复杂的规则，通过多次组合调用基础的 `es_sample_search.py` 来实现。分析出结果后，必须通过 `<UPDATE_INSIGHT>` 标签输出给大屏！
2. **绝对禁止盲猜**：如果用户在问题中**没有明确指定**要分析哪一种大屏图表，你**绝对不能**擅自做主挑选某个图表！你必须停止执行任何动作，并直接反问用户：'请问您具体想深挖大屏上的哪一个图表？'
3. **参数校验**：调用 `es_sample_search.py` 前必须确认你是否掌握 `task_ids` (必须是数组), `start_time` 和 `end_time`。如果缺少参数，直接反问用户。
4. **禁止编造假数据**：如果底层脚本调用报错（如缺少参数）或未查询到数据，你**必须如实回答**，在 `<UPDATE_INSIGHT>` 标签内写入“查询失败或无数据”，**绝对禁止**伪造任何示例文章或虚构数据！
5. **绝对禁止在 `<think>` 中输出标签**：你在 `<think>` 思考过程中**绝对不能**输出 `<UPDATE_INSIGHT>` 标签！你必须在确认获取到数据、思考完毕后，在**最终的正式回复**中才能使用该标签进行投射。
