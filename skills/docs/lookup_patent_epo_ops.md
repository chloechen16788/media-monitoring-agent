【功能】: 使用 EPO OPS 查询专利书目信息，并提取公开日期作为 `grant_publication_date`（Google 未命中时的二级兜底源）。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/lookup_patent_epo_ops.py "{\"patent_number\":\"EP1000000A1\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - patent_number (必需): 专利号（建议 epodoc 形式，如 `EP1000000A1` / `CN117228691B`）。
【环境变量】:
  - SKILL_EPO_OPS_KEY (必需): OPS Consumer Key。
  - SKILL_EPO_OPS_SECRET (必需): OPS Consumer Secret。
【返回格式】: JSON。成功: `{\"ok\": true, \"data\": {...}}`；失败: `{\"ok\": false, \"error\", \"hint\"}`。
  - data.source: 固定为 `epo_ops`。
  - data.patent_number: 归一化专利号。
  - data.grant_publication_date: 命中时返回 `YYYY-MM-DD`；未命中返回空字符串。
  - data.matched: 是否命中。
  - data.source_url: 实际 OPS 请求地址。
