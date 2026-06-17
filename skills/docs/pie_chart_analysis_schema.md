# 饼图/环形图分析全流程 SOP (Pie Chart Analysis Schema)

当用户要求"看情感分布"、"渠道占比"、"品牌声量对比"、"媒体来源构成"、"画饼图/环形图"等意图时，你必须严格按本说明书串联以下 A 类技能：
`es_agg_search`（取数）→ `render_pie_chart`（渲染）→ `es_sample_search`（切片抽样归因）。

## 技能关联原则（必读）

1. **技能之间永不互相调用**。每个 A 类脚本都是独立的纯工具；取数、变换、渲染、抽样之间的衔接由**你（模型）**按本说明书编排完成。
2. 每一步都是**一条独立的白名单命令**（`python skills/....py "<JSON>"`）。**绝对禁止** bash for 循环、管道、`&&` 串联——需要 N 次调用就发 N 条独立命令。
3. Master 规划时，task_contract.allowed_skills 必须同时包含本流程用到的全部可执行技能：`["es_agg_search", "es_sample_search", "render_pie_chart"]`，缺一则 Sub 会被沙箱拦截。

## Step 1: 数据齐备性检查与取数

饼图/环形图展示**分布比例**，需要"分类名称 + 每类数量"。根据用户意图选择 `es_agg_search` 的维度：

| 意图 | dimensions | 返回结果字段 |
|------|-----------|------------|
| 情感占比（正/中/负） | `["sentiment"]` | `aggs.sentiment[tid]` → `[{sentiment_id, sentiment_name, doc_count}]` |
| 渠道分布（微博/微信/网媒...） | `["channel"]` | `aggs.channel[tid]` → `[{channel_id, channel_name, doc_count}]` |
| 品牌声量对比（SOV）| `["sov"]` | `aggs.sov` → `[{task_id, doc_count}]`（需额外提供品牌名映射） |
| 媒体来源 Top N | `["sources"]` | `aggs.sources[tid]` → `[{media_name, doc_count, total_prn}]` |

```text
python skills/es_agg_search.py "{\"uid\": \"<系统通知提供>\", \"task_ids\": [6860], \"start_time\": \"2026-05-01 00:00:00\", \"end_time\": \"2026-05-31 23:59:59\", \"dimensions\": [\"sentiment\"]}"
```

- 若缺少 uid / task_ids / 时间范围，**停止执行并输出 `PARAM_REQUEST` 魔法码请求补参**，禁止编造。推荐字段：
  - `uid`（text, required, pattern: `^\d{6,12}$`）
  - `task_ids`（text, required, pattern: `^\d+(,\d+)*$`，hint: 逗号分隔数字）
  - `time_range`（daterange, required，前端回传时会携带 `start_time/end_time`）
- **partition 硬规则**：不传 partition 时脚本自动按 start_time 月份推导（推荐做法）；跨月查询会被拒绝。

## Step 2: 数据变换（你的职责，不写脚本）

将 ES 聚合结果转换为 `render_pie_chart` 的入参格式 `[{name: "...", value: 123}]`。

- **名称必须用中文可读标签，禁止用原始 ID**：
  - 情感：取 `sentiment_name`（"负面"/"中性"/"正面"），**绝不能**用 `sentiment_id`（-1/0/1）
  - 渠道：取 `channel_name`（"微博"/"微信"/"网媒资讯"...），**绝不能**用 `channel_id`（108/110...）
  - 媒体来源：直接取 `media_name` 字段
  - SOV 品牌：把 `task_id` 对应的品牌名写入 `name`（从任务上下文获取，禁止编造）
- 按 `doc_count` 降序排列。
- 若某类数量为 0 或极小（占比 < 0.5%）可合并为"其他"，避免图例过多。

## Step 3: 渲染饼图/环形图

```text
python skills/executor/render_pie_chart.py "{\"data\": [...], \"name_field\": \"name\", \"value_field\": \"value\", \"chart_type\": \"donut\", \"title\": \"情感分布\", \"theme\": \"default\", \"top_slices\": 3}"
```

- `chart_type`：
  - `"donut"` 推荐用于舆情分析场景（环形中间可放置总量数字，视觉更专业）
  - `"pie"` 适用于切片较多（>5）或简洁报告场景
- `top_slices`：控制 `data.top_slices` 返回几个切片用于抽样，默认 3，与饼图总切片数无关（所有切片都会渲染）。
- 样式切换：仅通过 `theme` 参数（"default" 亮色 / "dark" 深色大屏），不要试图自行拼接 ECharts 样式。
- 返回的 `data.chart_block` 是给前端的完整渲染魔法码整串（Step 5 直接原样复制）；`data.top_slices` 是 Step 4 的输入。
- 若返回 `ok: false`，按 `hint` 提示处理，禁止伪造数据。

## Step 4: 切片抽样归因（top10 finger）

对 `top_slices` 中的每个切片，**分别发起一条独立命令**抽取该切片 Top10 去重热门文章。切片类型不同，`es_sample_search` 的过滤参数不同：

| 切片维度 | 过滤参数 | 示例 |
|---------|---------|------|
| 情感切片（如"负面"） | `sentiment_filter: <sentiment_id>` | "负面" → `sentiment_filter: -1`；"正面" → `sentiment_filter: 0`；"中性" → `sentiment_filter: 1` |
| 渠道切片（如"微博"） | `channel_filter: <channel_id>` | "微博" → `channel_filter: 108`；"微信" → `channel_filter: 110`；"网媒资讯" → `channel_filter: 105` |
| SOV 品牌切片（如"品牌A"） | `task_ids: [<该品牌task_id>]` | 直接传该品牌的单个 task_id |
| 媒体来源切片（如"新浪网"） | `keywords: "<media_name>"` | 模糊匹配媒体名（无精确 media 过滤参数，为兜底方案） |

**情感 ID 硬对照**（sentiment_id 在取数结果中已给出，此处仅作备查）：负面=-1，正面=0，中性=1

**渠道 ID 硬对照**（部分常见）：微博=108，微信=110，网媒资讯=105，论坛=106，博客=107，视频=111，资讯APP=112，短视频=121

3 个切片各一条命令，时间范围与 Step 1 保持一致：

```text
python skills/es_sample_search.py "{\"uid\": \"<同上>\", \"task_ids\": [6860], \"start_time\": \"2026-05-01 00:00:00\", \"end_time\": \"2026-05-31 23:59:59\", \"size\": 10, \"sentiment_filter\": -1}"
```

```text
python skills/es_sample_search.py "{\"uid\": \"<同上>\", \"task_ids\": [6860], \"start_time\": \"2026-05-01 00:00:00\", \"end_time\": \"2026-05-31 23:59:59\", \"size\": 10, \"channel_filter\": 108}"
```

## Step 5: 总结输出

整合各切片的抽样结果，输出结构化分析：

1. **渲染图表**：把 render_pie_chart 返回的 `data.chart_block` **一字不差地原样复制**到你的回复正文中（它本身就是以 CHART_OPTION_START/END 标记包裹的完整整串），前端会在聊天中直接渲染出饼图/环形图。
   - **严禁**手抄、重排、美化、增删其中任何字符——手写 JSON 极易漏括号导致渲染失败；**不要**用 ``` 代码块包裹。
2. 各切片占比汇总（切片名、数量、百分比）。
3. 每个 Top N 切片的代表性文章（标题+来源+互动量），归因该切片的典型内容特征。
4. 整体分布结论：主导切片分析、异常偏高/偏低切片、风险或机会提示。
5. 大屏场景（任务来自整份报告流程）下，另用 `<UPDATE_INSIGHT target="{entityKey}_distribution">` 投射结论（规则见 advanced_chart_sampling 说明书）。
6. 任一切片抽样无数据时如实说明"该切片未抽到样本"，**绝对禁止**编造文章。

**【严禁】**：单图分析任务**绝对禁止**输出 `[WORKSPACE_SCHEMA_START]...[WORKSPACE_SCHEMA_END]` 报告配置卡魔法码——那是 generate_report 整份报告大屏流程的专用指令，单一图表与报告无关。
