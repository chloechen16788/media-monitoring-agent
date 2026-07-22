【功能】: 将 es_sample_search 返回的 articles 按 batch_size 切分为多个 JSONL 文件（一行一条，保留所有字段），并生成 manifest.json 作为批次状态唯一事实源，支撑“导一批标一批”的分批标注流转。本技能是纯计算工具，不取数；完整流程见 bmw_tagging 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/es_export_jsonl_batches.py "{\"sample_output\":{\"status\":\"success\",\"articles\":[{\"taskId\":6860,\"title\":\"示例\",\"content_snippet\":\"...\"}]},\"run_id\":\"bmw_6860_202606\",\"batch_size\":1000,\"export_dir\":\"./workspace\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - input_jsonl: 可选。直接从 JSONL 文件读取记录切批（推荐大批量链路使用，避免把大对象放进参数）。
  - articles: 可选。对象数组，直接传待切批的文章列表。
  - sample_output: 可选。es_sample_search 的完整输出对象（需含 articles）。
  - es_sample_output: 可选。与 sample_output 等价的别名入参。
  - run_id: 批次组标识，用于隔离目录（仅保留字母数字下划线短横）。缺省自动生成。
  - batch_size: 每批条数，默认 1000，建议 500~1000。
  - export_dir: 导出根目录，默认 "./workspace"。
【返回格式】: JSON。成功: {"ok": true, "data": {"run_id","run_dir","manifest_path","batch_count","total","batches"}}；失败: {"ok": false, "error", "hint"}。
  - 产物目录结构: <export_dir>/<run_id>/manifest.json + raw/batch_000.jsonl ...
  - manifest.batches[]: {"id","range","count","raw","annotated","status"}；status 取 exported/annotating/annotated。
  - 每条记录会注入 _row（全局行号），用于标注阶段顺序回填。
  - 写入采用临时文件 + 原子 rename，保证读方不会读到半截文件。

【示例 - 直接传 articles 切批】:
python skills/executor/es_export_jsonl_batches.py "{\"articles\":[{\"taskId\":6860,\"title\":\"A\",\"content_snippet\":\"...\"},{\"taskId\":6860,\"title\":\"B\",\"content_snippet\":\"...\"}],\"run_id\":\"bmw_demo\",\"batch_size\":1}"
