【功能】: 查询 Google Patents 并提取专利授权公开日（`grant_publication_date`）。适合作为专利日期查询链路的第一优先数据源。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/lookup_patent_google.py "{\"patent_number\":\"CN117228691B\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - patent_number (必需): 专利号（如 `CN117228691B`）。
  - search_limit: 可选。直连失败后，Google Patents 搜索兜底的最大 URL 数（默认 6）。
  - 回退策略: 对 `B`/`U` 号会自动尝试同号 `A` 页面，并标记是否为回退命中。
【环境变量】:
  - SKILL_FIRECRAWL_API_KEY (必需): Firecrawl API Key，用于页面抓取与搜索。
【返回格式】: JSON。成功: `{\"ok\": true, \"data\": {...}}`；失败: `{\"ok\": false, \"error\", \"hint\"}`。
  - data.source: 固定为 `google_patents`。
  - data.patent_number: 归一化专利号。
  - data.grant_publication_date: 命中时返回 `YYYY-MM-DD`；未命中返回空字符串。
  - data.matched: 是否命中授权公开日。
  - data.matched_patent_number: 实际命中的专利号（可能是回退号，如 `...A`）。
  - data.matched_via_fallback: 是否通过回退号命中。
  - data.source_url / visited_urls: 实际抓取 URL 信息，便于排障。
