# 词云分析全流程 SOP (Word Cloud Analysis Schema)

当用户要求"看词云"、"关键词热度图"、"高频词分布"、"热词可视化"、"词频词云"等意图时，你必须严格按本说明书串联以下 A 类技能：
`es_agg_search`（取数）→ `render_word_cloud`（渲染）→ `es_sample_search`（TopN 词条抽样归因）。

## 技能关联原则（必读）

1. **技能之间永不互相调用**。每个 A 类脚本都是独立的纯工具；取数、变换、渲染、抽样由你（模型）按本说明书编排。
2. 每一步都是**一条独立的白名单命令**（`python skills/....py "<JSON>"`）。**绝对禁止** bash for 循环、管道、`&&` 串联。
3. Master 规划时，`task_contract.allowed_skills` 必须同时包含：`["es_agg_search", "es_sample_search", "render_word_cloud"]`，缺一则 Sub 执行时会被沙箱拦截。

## Step 1: 数据齐备性检查与取数

词云展示**词频/实体出现频次**，需要"词语名称 + 频次"。根据用户意图选择 `es_agg_search` 维度：

| 意图 | dimensions | 返回结果字段 |
|------|-----------|------------|
| 关键词热词词云 | `["keyword_freq"]` | `aggs.keyword_freq[tid].top_keywords` → `[{word, total_count, doc_count}]` |
| 实体词云（混合人名/机构/地名） | `["named_entities"]` | `aggs.named_entities[tid].top_entities` → `[{entity_name, doc_count}]` |
| 人名/机构/地名分类词云 | `["named_entities"]` + `entity_top_n: 50` | `aggs.named_entities[tid].top_entities_by_type.PERSON/ORGANIZATION/LOCATION.items` |

```text
python skills/executor/es_agg_search.py "{\"uid\":\"<系统通知提供>\",\"task_ids\":[6860],\"start_time\":\"2026-06-01 00:00:00\",\"end_time\":\"2026-06-30 23:59:59\",\"dimensions\":[\"keyword_freq\"]}"
```

- 若缺少 uid / task_ids / 时间范围，停止执行并输出 `PARAM_REQUEST` 魔法码请求补参。
- `partition` 可缺省自动推导；跨月查询会被拒绝，需按月拆分。

## Step 2: 数据变换（你的职责，不写脚本）

将 ES 聚合结果转换为 `render_word_cloud` 入参格式 `[{name: "...", value: 123}]`。

推荐映射：
- `keyword_freq.top_keywords`：`name=word`, `value=total_count`（关键词总词频）
- `named_entities.top_entities`：`name=entity_name`, `value=doc_count`（混合实体）
- `named_entities.top_entities_by_type.<TYPE>.items`：`name=entity_name`, `value=doc_count`（分类实体）

注意：
- 名称必须可读，优先中文标签；禁止把裸 ID 展示给用户。
- 停用词/无意义短词（如"的"、"了"、"是"）若出现在 keyword_freq 中，模型侧应过滤后再传入。
- 按 value 降序，高频词字号更大。

## Step 3: 渲染词云

```text
python skills/executor/render_word_cloud.py "{\"data\":[...],\"title\":\"关键词云\",\"subtitle\":\"ManusAI 2026年6月\",\"top_n\":80,\"top_items_n\":10,\"shape\":\"circle\",\"theme\":\"default\"}"
```

- `top_n`：词云展示词数，默认 100。词数过少（<20）视觉效果差，建议 50~150。
- `top_items_n`：控制 `data.top_items` 返回几条用于抽样，默认 10，与词云展示数量无关。
- `shape`：词云形状，推荐 `"circle"`（通用）；大屏专题可用 `"star"`（星形）或 `"diamond"`（菱形）。
- 字号由词频对数缩放自动计算，无需手动指定。
- 返回的 `data.chart_block` 是前端渲染整串；`data.top_items` 是 Step 4 抽样输入。
- 若返回 `ok: false`，按 `hint` 修正，禁止伪造数据。

## Step 4: Top10 词条抽样归因

对 `top_items` 中关键词条（通常 Top3~Top5）逐条发起独立抽样命令，提取每组代表性文章。

| 词云数据来源 | 抽样过滤方式 | 示例参数 |
|------------|------------|--------|
| 关键词词云 | `keywords: "<word>"` | 词语作为全文检索关键词 |
| 实体词云（人名/机构/地名） | `keywords: "<entity_name>"` | 实体名作为关键词检索 |

对 Top3 词条各发一条独立命令（时间范围与 Step 1 保持一致）：

```text
python skills/executor/es_sample_search.py "{\"uid\":\"<同上>\",\"task_ids\":[6860],\"start_time\":\"2026-06-01 00:00:00\",\"end_time\":\"2026-06-30 23:59:59\",\"size\":10,\"keywords\":\"<top1词名>\"}"
```

```text
python skills/executor/es_sample_search.py "{\"uid\":\"<同上>\",\"task_ids\":[6860],\"start_time\":\"2026-06-01 00:00:00\",\"end_time\":\"2026-06-30 23:59:59\",\"size\":10,\"keywords\":\"<top2词名>\"}"
```

## Step 5: 总结输出

1. **渲染词云**：把 `render_word_cloud` 返回的 `data.chart_block` 原样复制到回复正文，前端直接渲染。严禁手抄/重排/美化。
2. 输出 **Top10 词条明细**（排名 / 词语 / 频次 / 占比），让用户清晰看到数值。
3. 对 Top3~5 词条给出代表性样本（标题+来源+互动量）及归因说明。
4. 整体词频分布结论：高频主题群、长尾词分布、异常突出词分析。
5. 任一词条抽样无数据时如实说明，**绝对禁止**编造文章。

**【严禁】**：单图分析任务禁止输出 `[WORKSPACE_SCHEMA_START]...[WORKSPACE_SCHEMA_END]` 报告配置卡魔法码。
