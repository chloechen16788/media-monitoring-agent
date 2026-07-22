【功能】: 从行数据中的正文/文本字段批量提取专利号，并写回每行的 `patent_numbers`、`first_patent_number`、`patent_count`。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/extract_patent_numbers.py "{\"rows\":[{\"__row_id\":1,\"content\":\"...CN117228691B...\"}],\"content_fields\":[\"content\"]}"
【参数说明】 (以 JSON 字符串形式传入):
  - rows (必需): 对象数组，通常来自 `read_tabular_data` 的输出。
  - content_fields: 可选。要拼接检索的文本字段列表，默认 `["content","正文","text","body"]`。
  - include_countries: 可选。国家/组织前缀过滤，默认 `["CN","EP","WO","US"]`。
  - write_back_field: 可选。提取结果回写字段名，默认 `patent_numbers`。
  - keep_existing: 可选。若为 true 且写回字段已有数组，则保留并去重，不重新提取。
【返回格式】: JSON。成功: `{\"ok\": true, \"data\": {\"rows\", \"stats\"}}`；失败: `{\"ok\": false, \"error\", \"hint\"}`。
  - rows: 每行新增 `patent_numbers`（数组）、`first_patent_number`、`patent_count`。
  - stats: 含 `unique_patent_numbers`、`unique_patent_count`、`rows_with_patent` 等统计信息。
