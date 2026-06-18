# 条形图分析全流程 SOP (Bar Chart Analysis Schema)

当用户要求"看 TOP10 排行"、"组织/媒体/标签条形图"、"分类对比柱状图"、"实体排行榜"等意图时，你必须严格按本说明书串联以下 A 类技能：
`es_agg_search`（取数）→ `render_bar_chart`（渲染）→ `es_sample_search`（TopN 抽样归因）。

## 技能关联原则（必读）

1. **技能之间永不互相调用**。每个 A 类脚本都是独立纯工具；取数、变换、渲染、抽样由你（模型）按本说明书编排。
2. 每一步都是**一条独立白名单命令**（`python skills/....py "<JSON>"`）。**绝对禁止** bash for 循环、管道、`&&` 串联。
3. Master 规划时，`task_contract.allowed_skills` 必须同时包含：`["es_agg_search", "es_sample_search", "render_bar_chart"]`。

## Step 1: 数据齐备性检查与取数

条形图用于展示排行榜或分组对比，需要"类目名称 + 数值"。根据用户意图选择 `es_agg_search` 维度：

| 意图 | dimensions | 返回结果字段 |
|------|-----------|------------|
| 组织/实体 TOP10（混合） | `["named_entities"]` | `aggs.named_entities[tid].top_entities` |
| 人名/机构/地名 TOP10（分类型） | `["named_entities"]` + `entity_top_n: 10` | `aggs.named_entities[tid].top_entities_by_type.PERSON/ORGANIZATION/LOCATION.items` |
| 关键词 TOP10 | `["keyword_freq"]` | `aggs.keyword_freq[tid].top_keywords` |
| 媒体来源 TOP10 | `["sources"]` | `aggs.sources[tid]` |
| 渠道分布排行 | `["channel"]` | `aggs.channel[tid]` |
| 分类排行 | `["category"]`/`["sub_category"]` | `aggs.category[tid].items` / `aggs.sub_category[tid].items` |
| 标签排行 | `["tag"]` | `aggs.tag[tid].items` |

```text
python skills/executor/es_agg_search.py "{\"uid\":\"<系统通知提供>\",\"task_ids\":[6860],\"start_time\":\"2026-05-01 00:00:00\",\"end_time\":\"2026-05-31 23:59:59\",\"dimensions\":[\"named_entities\"]}"
```

- 若缺少 uid / task_ids / 时间范围，停止执行并输出 `PARAM_REQUEST` 魔法码请求补参。
- `partition` 可缺省自动推导；跨月查询会被拒绝，需按月拆分。

## Step 2: 数据变换（你的职责，不写脚本）

将 ES 聚合结果转换为 `render_bar_chart` 入参格式：`[{name: "...", value: 123}]`。

推荐映射：
- `named_entities.top_entities`：`name=entity_name`, `value=doc_count`（全局混合排行）
- `named_entities.top_entities_by_type.<TYPE>.items`：分类型排行，`name=entity_name`, `value=doc_count`；`<TYPE>` 取 `PERSON`（人名）、`ORGANIZATION`（机构）、`LOCATION`（地名）；图表标题建议用 `entity_type_label`（人名/机构/地名）
- `keyword_freq.top_keywords`：`name=word`, `value=total_count`
- `sources`：`name=media_name`, `value=doc_count`
- `channel`：`name=channel_name`, `value=doc_count`
- `category/sub_category/tag`：`name` 先用 ID 字符串（若上下文有字典映射则转中文名），`value=doc_count`

注意：
- 名称必须可读，优先中文标签；禁止把裸 ID 直接给用户展示（无映射时可用 `"分类#123"` 这类可读占位）。
- 按 value 降序后再截取 Top10。

## Step 3: 渲染条形图

分类型实体场景：对 `PERSON`、`ORGANIZATION`、`LOCATION` 各调用一次 `render_bar_chart`，分别出三张图（标题示例：`人名 Top10`、`机构 Top10`、`地名 Top10`）。

```text
python skills/executor/render_bar_chart.py "{\"data\":[...],\"title\":\"TOP10组织分析\",\"subtitle\":\"爱玛电动车\",\"orientation\":\"horizontal\",\"top_n\":10,\"theme\":\"default\"}"
```

- `orientation` 默认 `horizontal`，更适合长名称排行（和业务大屏风格一致）。
- 返回的 `data.chart_block` 是前端渲染整串；`data.top_items` 是 Step 4 抽样输入。
- 若返回 `ok: false`，按 `hint` 修正，禁止伪造数据。

## Step 4: TopN 条目抽样归因（top10 finger）

对 `top_items` 中关键条目（通常 Top3~Top5）逐条发起独立抽样命令，提取每组 Top10 去重文章。

常见过滤映射：
- 实体/关键词/媒体：用 `keywords`
- 渠道：用 `channel_filter`
- 分类/标签：无精确过滤参数时，用分类/标签名作为 `keywords` 兜底检索

```text
python skills/executor/es_sample_search.py "{\"uid\":\"<同上>\",\"task_ids\":[6860],\"start_time\":\"2026-05-01 00:00:00\",\"end_time\":\"2026-05-31 23:59:59\",\"size\":10,\"keywords\":\"爱玛\"}"
```

```text
python skills/executor/es_sample_search.py "{\"uid\":\"<同上>\",\"task_ids\":[6860],\"start_time\":\"2026-05-01 00:00:00\",\"end_time\":\"2026-05-31 23:59:59\",\"size\":10,\"channel_filter\":108}"
```

## Step 5: 总结输出

1. **渲染图表**：把 `render_bar_chart` 返回的 `data.chart_block` 原样复制到回复正文，前端会直接渲染。
2. 输出 TopN 对比结论：主导项、断层、长尾结构。
3. 对 Top 条目给出代表性样本与归因（标题+来源+互动量）。
4. 任一条目抽样无数据时必须如实说明，禁止编造。

**【严禁】**：单图分析任务禁止输出 `[WORKSPACE_SCHEMA_START]...[WORKSPACE_SCHEMA_END]` 报告配置卡魔法码。
