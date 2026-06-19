【功能】: 将 `es_sample_search` 的抽样结果导出为 Excel（.xlsx）文件，保留 `articles` 中全部字段（动态列，不丢字段）。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/export_es_sample_excel.py "{\"sample_output\":{\"status\":\"success\",\"articles\":[{\"taskId\":6860,\"title\":\"示例\",\"media\":\"某媒体\",\"time\":\"2026-06-19 10:00:00\",\"dataChannel\":108,\"channel_source_name\":\"微博\",\"blurb\":\"摘要\",\"fingerprint_cluster_size\":23,\"content_snippet\":\"...\"}]},\"report_name\":\"Manus_负面抽样\",\"export_dir\":\"./workspace\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - articles: 可选。对象数组，直接传待导出的文章列表。
  - sample_output: 可选。`es_sample_search` 的完整输出对象（需包含 `articles`）。
  - es_sample_output: 可选。与 sample_output 等价的别名入参。
  - input_jsonl_dir: 可选。目录路径，合并该目录下所有 `*.jsonl`（按文件名排序）导出，常用于 BMW 标注后的 annotated 目录汇总出总表。
  - input_jsonl: 可选。单个 jsonl 文件路径。
  - 输入优先级：input_jsonl_dir > input_jsonl > articles > sample_output > es_sample_output。
  - report_name: 可选。报告名称，用于生成默认文件名，默认 "ES抽样结果"。
  - filename: 可选。导出文件名（可不带 .xlsx 后缀）。缺省时自动生成。
  - export_dir: 可选。导出目录，默认 "./workspace"。
【返回格式】: JSON。成功: {"ok": true, "data": {"file_path","download_path","filename","article_count","columns"}}；失败: {"ok": false, "error", "hint"}。
  - file_path: 导出文件绝对路径。
  - download_path: 聊天下载链接可用的相对路径（`./workspace/<filename>`）。
  - columns: 本次导出的全部列名（按首次出现顺序）。

【示例 - 直接传 articles 导出】:
python skills/executor/export_es_sample_excel.py "{\"articles\":[{\"taskId\":6860,\"title\":\"示例A\",\"media\":\"媒体A\",\"time\":\"2026-06-19 10:00:00\",\"dataChannel\":108,\"channel_source_name\":\"微博\",\"blurb\":\"摘要A\",\"fingerprint_cluster_size\":11,\"content_snippet\":\"...\"},{\"taskId\":6860,\"title\":\"示例B\",\"media\":\"媒体B\",\"time\":\"2026-06-19 11:00:00\",\"extra_field\":\"保留扩展字段\"}],\"report_name\":\"ES抽样导出\",\"export_dir\":\"./workspace\"}"
