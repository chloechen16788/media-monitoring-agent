# BMW 数据标注全流程 SOP (BMW Tagging Schema)

当用户要求“导出某 task 数据并打标”“BMW 硬核科技新闻标注”“分批标注后导出 Excel”等意图时，按本说明书串联：
`es_sample_search`（取数，含 blurb 与正文）→ `es_export_jsonl_batches`（切批 JSONL）
→ `bmw_tag_jsonl`（逐批调标注模型）→ `export_es_sample_excel`（合并 annotated 出 Excel）。

## 技能关联原则（必读）

1. **技能之间永不互相调用**，编排由你（模型）按本剧本完成。
2. 每步一条独立白名单命令（`python skills/....py "<JSON>"`）；**禁止** bash 循环/管道/`&&`。
3. Master 规划时 `task_contract.allowed_skills` 必须含：
   `["es_sample_search","es_export_jsonl_batches","bmw_tag_jsonl","export_es_sample_excel"]`

## 开工前契约检查（防返工）

- 在执行 Step 1 前，先检查 `task_contract.allowed_skills` 是否完整包含以下 4 项：
  `es_sample_search`、`es_export_jsonl_batches`、`bmw_tag_jsonl`、`export_es_sample_excel`。
- 若缺任一项（尤其 `es_export_jsonl_batches`），**禁止直接开工**；先回到 Master 规划补齐契约，再继续执行。
- 自检口径：缺技能 != 临时绕过。必须以契约白名单为准，避免执行中途被策略拦截返工。
- 对用户的反馈话术应直接说明：`task_contract.allowed_skills` 缺失 `<skill_id>`，需先补契约后再继续。

## 模型隔离硬规则（成本围栏，必读）

- 标注模型（Gemini）**只能**通过 `bmw_tag_jsonl` 调用，仅读取 `SKILL_TAGGING_*` 配置。
- 默认 `provider:"gemini"` 走 Google 原生 `generateContent` 接口（QPS 高）；备用 `provider:"gateway"`（OpenAI 兼容网关，QPS 低）。
- **严禁**把 Gemini 用于对话、规划或其他推理；对话/编排仍用 minimax（`WORKER_MODEL`）。

## Step 1: 取数（默认走标题+摘要 blurb）

调 `es_sample_search` 获取 `title`、`blurb` 与 `content_snippet`。标注默认使用 `title+blurb`；
只有明确要求时才在 Step 3 切到 `title+content_snippet` 并设置 `content_max_chars: 2000`。

```text
python skills/executor/es_sample_search.py "{\"uid\":\"<系统通知提供>\",\"task_ids\":[6860],\"start_time\":\"2026-06-01 00:00:00\",\"end_time\":\"2026-06-30 23:59:59\",\"size\":10000,\"output_jsonl\":\"./workspace/bmw_6860_202606/es_sample.jsonl\"}"
```

- 缺 uid/task_ids/时间范围 → 输出 `PARAM_REQUEST` 请求补参，禁止编造。
- 跨月会被拒绝，按月拆分多次调用。

## Step 2: 切批落 JSONL

调 `es_export_jsonl_batches`，从 Step1 的 `output_jsonl` 读取并切批（建议 `batch_size` 500~1000）。

```text
python skills/executor/es_export_jsonl_batches.py "{\"input_jsonl\":\"./workspace/bmw_6860_202606/es_sample.jsonl\",\"run_id\":\"bmw_6860_202606\",\"batch_size\":1000}"
```

- 产物：`./workspace/<run_id>/manifest.json` + `raw/batch_*.jsonl`。
- manifest 是批次状态唯一事实源，记录每批 `status`（exported/annotated）。

## Step 3: 逐批标注（导一批标一批）

读 manifest，找 `status=exported` 的**下一个**批次，对该批调一次 `bmw_tag_jsonl`（一次只处理一批，**禁止循环**）：

```text
python skills/executor/bmw_tag_jsonl.py "{\"manifest_path\":\"./workspace/bmw_6860_202606/manifest.json\",\"provider\":\"gemini\",\"progress_file\":\"./workspace/bmw_6860_202606/progress/batch_000.json\"}"
```

- 标注完该批 manifest 自动置 `annotated`；再回到本步处理下一批，直到全部 `annotated`。
- 进度看 `progress/batch_*.json`（旁路文件）。
- 默认并发按模式自适应：`blurb=2`、`content=23`；且 `input_text_mode="blurb"` 时按 30 条/批发起模型调用（输出仍按单条回填）。
- 该模式不需要额外读取 manifest 文件内容；skill 内会自动挑选下一批 `exported`。
- 单批超 `max_records`（默认 1500）会报错，需减小 batch_size。
- 若业务明确要求使用正文：增加 `"input_text_mode":"content","content_max_chars":2000`。
- 任一批失败如实上报，不编造标注结果。

## Step 4: 合并导出 Excel

全部批次 `annotated` 后，调 `export_es_sample_excel`，传 annotated 目录合并出总表（主字段 + 标注字段）：

```text
python skills/executor/export_es_sample_excel.py "{\"input_jsonl_dir\":\"./workspace/bmw_6860_202606/annotated\",\"report_name\":\"BMW标注总表\"}"
```

- 返回 `download_path`，提示用户下载。

## Step 5: 总结输出

1. 汇总标注分布（是/否 各占比、异常/失败条数）。
2. 给出 Excel 下载链接（`download_path`）。
3. 如有失败批次或异常样本，如实说明，禁止编造。

**【严禁】**：本流程禁止输出 `[WORKSPACE_SCHEMA_START]...[WORKSPACE_SCHEMA_END]` 报告配置卡魔法码（与报告大屏无关）。
