# 折线图分析全流程 SOP (Line Chart Analysis Schema)

当用户要求"画趋势折线图"、"看声量走势"、"分析趋势高点"等意图时，你必须严格按本说明书串联以下 A 类技能：
`es_agg_search`（取数）→ `render_line_chart`（渲染）→ `es_sample_search`（峰值抽样归因）。

## 技能关联原则（必读）

1. **技能之间永不互相调用**。每个 A 类脚本都是独立的纯工具；取数、变换、渲染、抽样之间的衔接由**你（模型）**按本说明书编排完成。
2. 每一步都是**一条独立的白名单命令**（`python skills/....py "<JSON>"`）。**绝对禁止** bash for 循环、管道、`&&` 串联——需要 N 次调用就发 N 条独立命令。
3. Master 规划时，task_contract.allowed_skills 必须同时包含本流程用到的全部可执行技能：`["es_agg_search", "es_sample_search", "render_line_chart"]`，缺一则 Sub 会被沙箱拦截。

## Step 1: 数据齐备性检查

折线图输入数据**至少需要"时间 + 一个可统计字段"**（舆情数据通常包含发布时间、来源、作者、标题、摘要、链接，其中发布时间即时间字段，记录条数即可统计量）。

- 上下文中已有满足条件的数据 → 直接进入 Step 2。
- 数据不全或没有数据 → 先调用 ES 取数（趋势维度）。按用户目标选择维度：
  - 单线总声量：`["trend"]`
  - 负面趋势线：`["trend"] + sentiment_filter: [-1]` 或 `["trend_by_sentiment"]` 后只取负面系列
  - 正中负三线：`["trend_by_sentiment"]`
  - 按来源类型多线：`["trend_by_channel"]`

```text
python skills/es_agg_search.py "{\"uid\": \"<系统通知提供>\", \"task_ids\": [6860], \"start_time\": \"2026-05-01 00:00:00\", \"end_time\": \"2026-05-31 23:59:59\", \"dimensions\": [\"trend\"]}"
```

```text
python skills/es_agg_search.py "{\"uid\": \"<系统通知提供>\", \"task_ids\": [6860], \"start_time\": \"2026-05-01 00:00:00\", \"end_time\": \"2026-05-31 23:59:59\", \"dimensions\": [\"trend_by_sentiment\"]}"
```

- 若缺少 uid / task_ids / 时间范围，**停止执行并输出 `PARAM_REQUEST` 魔法码请求补参**，禁止编造。推荐字段：
  - `uid`（text, required, pattern: `^\\d{6,12}$`）
  - `task_ids`（text, required, pattern: `^\\d+(,\\d+)*$`，hint: 逗号分隔数字）
  - `time_range`（daterange, required，前端回传时会携带 `start_time/end_time`）
- **partition 硬规则**：ES 按月分库，partition 必须与 start_time/end_time 同月。**不传 partition 时脚本会自动按 start_time 月份推导（推荐做法）**；跨月查询会被拒绝，必须按月拆分为多次独立调用后自行合并结果。

## Step 2: 数据变换（你的职责，不写脚本）

把 Step 1 的趋势结果（或用户提供的原始记录）整理为 render_line_chart 的入参格式：

- 趋势统计结果 → `[{"time": "2026-04-01", "value": 123}, ...]`，调用时传 `value_field: "value"`。
- 情感/渠道趋势（嵌套聚合）→ 先扁平化为多线输入：`[{"time":"2026-04-01","value":123,"series":"负面"}, {"time":"2026-04-01","value":233,"series":"正面"}]`，并在渲染时传 `series_field: "series"`。
- **系列名必须用中文名称，禁止用 ID**：取数结果已带好对照名称——情感用 `sentiment_name`、渠道用 `channel_name`（`trend_by_channel`/`trend_by_sentiment` 每个桶都同时给出 `*_id` 与 `*_name`）。扁平化时一律取 `*_name` 作为 `series`，**绝不能**把 `channel_id`/`sentiment_id` 这类数字当系列名，否则图例会显示成无意义的 ID。
- 逐条舆情记录 → 直接传原始数组，指定 `time_field` 为发布时间字段名，不传 `value_field`（按条数计数）。

## Step 3: 渲染折线图

```text
python skills/executor/render_line_chart.py "{\"data\": [...], \"value_field\": \"value\", \"title\": \"XX声量趋势\", \"theme\": \"default\"}"
```

- 多线模式示例（正中负三线）：
```text
python skills/executor/render_line_chart.py "{\"data\": [...], \"value_field\": \"value\", \"series_field\": \"series\", \"peak_series\": \"负面\", \"title\": \"XX情感趋势\", \"theme\": \"default\"}"
```

- 样式切换：仅通过 `theme` 参数（"default" 亮色 / "dark" 深色大屏），不要试图自行拼接 ECharts 样式。
- 返回的 `data.chart_block` 是给前端的完整渲染魔法码整串（Step 5 直接原样复制）；`data.peaks` 是 Step 4 的输入：
  - 单线模式：峰值数组 `[{"time","value"}]`
  - 多线模式：分组对象 `{"系列名":[{"time","value"}]}`，优先使用 `peak_series` 指定系列进行抽样归因
- 若返回 `ok: false`，按 `hint` 提示处理（通常是回到 Step 1 取数），禁止伪造数据。

## Step 4: 峰值抽样归因（top10 finger）

对 `peaks` 中选定系列的每个高点日期，**分别发起一条独立命令**抽取该日 Top10 去重（finger 指纹）热门文章。例如 3 个峰值就是 3 条命令：

```text
python skills/es_sample_search.py "{\"uid\": \"<同上>\", \"partition\": \"<同上>\", \"task_ids\": [6860], \"start_time\": \"2026-04-12 00:00:00\", \"end_time\": \"2026-04-12 23:59:59\", \"size\": 10}"
```

- 只做负面归因时，抽样可附加 `sentiment_filter: [-1]`，避免混入非负面样本。

## Step 5: 总结输出

整合三个峰值的抽样结果，输出结构化分析：

1. **渲染图表**：把 render_line_chart 返回的 `data.chart_block` **一字不差地原样复制**到你的回复正文中（它本身就是以 CHART_OPTION_START/END 标记包裹的完整整串），前端会在聊天中直接渲染出折线图。
   - **严禁**手抄、重排、美化、增删其中任何字符——手写 JSON 极易漏括号导致渲染失败；**不要**用 ``` 代码块包裹。
2. 每个峰值日期：当日声量、引爆事件/文章（标题+来源+互动量）、传播归因。
3. 整体趋势结论：上升/回落形态、异常点、风险提示。
4. 大屏场景（任务来自整份报告流程）下，另用 `<UPDATE_INSIGHT target="{entityKey}_trend_peak_events">` 投射结论（规则见 advanced_chart_sampling 说明书）。
5. 任一峰值抽样无数据时如实说明"该日期未抽到样本"，**绝对禁止**编造文章。

**【严禁】**：单图分析任务**绝对禁止**输出 `[WORKSPACE_SCHEMA_START]...[WORKSPACE_SCHEMA_END]` 报告配置卡魔法码——那是 generate_report 整份报告大屏流程的专用指令，单一图表与报告无关，误输出会在前端弹出无关的报告配置卡片。
