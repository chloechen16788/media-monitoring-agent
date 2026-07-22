【功能】: 将 enriched rows 回写到原始文件副本（xlsx/csv/jsonl），支持新增列（如 `授权公开日`）并保留原结构。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/write_tabular_data.py "{\"source_path\":\"./workspace/input.xlsx\",\"rows\":[{\"__row_id\":1,\"授权公开日\":\"2024-08-06\"}],\"output_path\":\"./workspace/input_enriched.xlsx\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - source_path (必需): 原始文件路径，支持 xlsx/csv/jsonl。
  - rows (必需): 要回写的对象数组，建议保留 `__row_id` 或 `__source_row_number`。
  - output_path: 可选。输出路径；不传默认在原文件同目录生成 `_enriched` 后缀文件。
  - file_type: 可选。`xlsx` / `csv` / `jsonl`，默认按扩展名识别。
  - update_fields: 可选。仅回写这些字段；不传则自动回写所有非 `__` 开头字段。
  - sheet_name/sheet_index/header_row/start_row: 可选。xlsx 回写定位参数，与读取阶段保持一致。
  - encoding/delimiter: 可选。csv 编码与分隔符。
  - keep_meta_fields: 可选。jsonl 输出是否保留 `__` 元字段，默认 false。
【返回格式】: JSON。成功: `{\"ok\": true, \"data\": {\"output_path\", \"file_type\", \"meta\"}}`；失败: `{\"ok\": false, \"error\", \"hint\"}`。
  - meta 含 updated_rows、updated_fields、updated_cells 等统计信息。
