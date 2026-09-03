【功能】: 读取表格/结构化文件（xlsx/csv/jsonl）并标准化为统一 `rows` 对象数组，供后续提取、查询、回写技能复用。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/read_tabular_data.py "{\"source_path\":\"./workspace/input.xlsx\",\"file_type\":\"xlsx\",\"sheet_index\":0,\"header_row\":1}"
【参数说明】 (以 JSON 字符串形式传入):
  - source_path (必需): 输入文件路径，支持 xlsx/csv/jsonl。
  - file_type: 可选。`xlsx` / `csv` / `jsonl`。不传则按扩展名自动识别。
  - sheet_name: 可选。xlsx 指定工作表名称。
  - sheet_index: 可选。xlsx 工作表序号（默认 0）。
  - header_row: 可选。xlsx 表头行号（默认 1）。
  - start_row: 可选。xlsx 起始数据行（默认 `header_row + 1`）。
  - encoding: 可选。csv 编码，默认 `utf-8-sig`。
  - delimiter: 可选。csv 分隔符，默认 `,`。
  - max_rows: 可选。最多读取多少条；不传或传 0 表示不限制（默认全量读取）。
  - fields: 可选。仅保留指定字段列表。
【返回格式】: JSON。成功: `{"ok": true, "data": {"source_path", "rows", "meta"}}`；失败: `{"ok": false, "error", "hint"}`。
  - rows: 每行会附带 `__row_id` 与 `__source_row_number`，用于后续精确回写。
  - meta: 包含 file_type、row_count、columns、sheet_name（xlsx）等元信息。
  - meta.max_rows_applied / meta.truncated: 用于判断是否触发了行数截断。
【使用注意】:
  - 只要查看/抽出某列原文（不打标、不拉接口）时用本技能；可用 `fields` 只留该列。
  - 按笔记链接补小红书互动数据不要用本技能，改用 xiaohongshu_note_detail_by_links。
  - 社媒打标不要用本技能，改用 ske_social_tagging。
