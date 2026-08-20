# 新闻周报流水线说明书（news_pipeline）

面向 Master 规划：把「搜索 <日期> 的新闻 → 出周报 Excel」拆解为可交接给 Sub 执行的
技能链。所有取数/加工 Sub 技能都遵循统一契约：模型只提供结构化 `args`，产物写入会话
工作区 `./workspace/`，密钥只从环境变量读取，stdout 返回单个 JSON `{ok,data,error,hint}`。

> 时间参数是硬约束：任何取数技能被规划前，必须先向用户确认查询时间范围。清博/豆包用
> `YYYY-MM-DD HH:MM:SS`，anysearch 用 `YYYY-MM-DD`。

## 全流程

```
取数 → 筛选(打标) → [人工挑选] → 补数 → 补正文 → 格式化 → [去重] → [溯源]
```

```mermaid
flowchart LR
  A["取数<br/>doubao / anysearch / qingbo×3"] --> B["筛选<br/>deepseek_excel_tagging"]
  B --> H1["人工挑选<br/>(改 Excel，保留要的行)"]
  H1 --> C["补数<br/>复用取数技能"]
  C --> D["补正文<br/>news_fulltext_excel"]
  D --> E["格式化<br/>news_excel_format"]
  E --> F["去重（本轮延后）"]
  F --> G["溯源（本轮延后）"]
```

## 阶段与技能

### 1. 取数（选一个或多个并行）
- `doubao_search`：豆包 web_search，多 query 并发、按标题去重。通用取数，也用于**搜专利**
  （把「50 条 <时间> 汽车行业专利」这类查询放进 `queries`）。
  - 入参：`{queries:[...], max_workers?, export_dir?}`
- `anysearch_industry_news`：固定 11 个中国产业主题 × 5 组变体检索，窗口期筛选，每主题≤50 条，
  多 sheet xlsx。入参：`{start:"YYYY-MM-DD", end:"YYYY-MM-DD", max_per_topic?}`
- `qingbo_domain_pri_export`：清博模板 B，一级域名定向（18 站点）× 11 主题词 AND 事件词。
  入参：`{start, end, count_only?}`（`HH:MM:SS`）。
- `qingbo_pedaily_export`：清博模板 C，投资界 pedaily.cn 标题检索 `IPO,融资`。入参同上。
- `qingbo_weixin_export`：清博微信公众号定向（固定 40 号名单）。入参同上。

> 清博技能支持 `count_only:true`：先只统计命中条数、不翻页导出，便于规划确认体量再全量取数。

出参：`data.output_path` 为 xlsx 路径，`data.total_rows`/`exported_unique`/`total` 等为条数。

### 2. 筛选（打标）
- `deepseek_excel_tagging`：读取取数产出的 Excel（标题+正文），DeepSeek 逐行判定是否
  「高价值硬核科技新闻」，追加 5 列（`is_important_tech_news/reason/tech_category/location/subject`）
  另存新 xlsx。
  - 入参：`{input_path, sheet?, title_col?="标题", content_col?="正文", max_workers?}`
  - 出参：`data.output_path`、`data.important`（判为「是」的条数）、`data.errors`

### 3. 人工挑选（检查点，非技能）
用户在打标后的 Excel 里保留需要的行、删除不要的行，另存后作为下一阶段输入。Master 应在此
停下，提示用户完成人工挑选并回传文件路径。

### 4. 补数（可选）
覆盖不足时，复用第 1 阶段任一取数技能补充检索（热搜 + 分类搜 + 人工补搜）。产出的新 Excel
再走一遍筛选/人工挑选。

### 5. 补正文
- `news_fulltext_excel`：按 `items:[{title,url}]` 抓取正文，站点专用 + 通用解析，清洗导航/
  相关推荐/重复段落，导出固定 7 列 xlsx（序号/标题/作者/媒体名称/url/日期/正文）。**无需密钥。**
  - 入参：`{items:[{title,url}], patches?:[{url,author?,media?,date?,body?}], filename?}`
  - `patches` 用于人工修订个别条目的字段（覆盖自动解析结果）。
  - 出参：`data.output_path`、`data.short_urls`（正文过短需人工补的链接）、`data.failed`

### 6. 格式化
- `news_excel_format`：读取周报 Excel（**必须含列「新闻标题」「新闻正文」**），
  GPT(OpenCode)+DeepSeek 双摘要 + DeepSeek 抽分类标签与专利号，追加 4 列
  （`正文摘要-GPT/正文摘要-Deepseek/备注/专利号`）导出 `*_格式化.xlsx`。
  - 入参：`{input_path, sheet?}`
  - 出参：`data.output_path`、`data.patent_hit`、`data.gpt_ok`、`data.ds_ok`

### 7-8. 去重 / 溯源（本轮延后）
`deepseek-news-dedup`（S1 两阶段去重）与 `news-origin-trace`（旧闻溯源）依赖较重的外部工具
包，本轮未迁移。规划时若涉及，明确告知用户这两步暂由 Cursor 侧原技能处理。

## 规划提示
- Master 通过本说明书 + `catalog` 看到全部技能，据此写 `allowed_skills`：典型「取数周报」
  任务 = 一个取数技能 + `deepseek_excel_tagging` + `news_fulltext_excel` + `news_excel_format`。
- 每个技能都是独立一步，产物路径在 `data.output_path`，把它作为下一步的 `input_path`/`items` 来源。
- 涉及人工挑选/人工补正文的检查点，务必在 `acceptance_criteria` 里写清由用户确认后再继续。
- 所需环境变量：`DOUBAO_API_KEY`（豆包）、`ANYSEARCH_API_KEY`（anysearch）、
  `QINGBO_BASE_URL/PROJECT_ID/SIGN/ROUTER`（清博）、`DEEPSEEK_API_KEY(/BASE_URL/MODEL)`（打标、格式化）、
  `OPENCODE_API_KEY(/BASE_URL/MODEL/CONCURRENCY)`（格式化 GPT 摘要）。由 gateway 注入，规划无需关心。
