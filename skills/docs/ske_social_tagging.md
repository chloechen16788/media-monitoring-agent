【功能】: 读取上传的 Excel 或 CSV，按指定列 + 提示词逐行抽取/生成字段，写出带新列的 xlsx 与 csv 到 ./workspace（前端自动出现下载按钮）。默认使用 SKE 社媒提示词，生成 media / date / author / sentiment / summary / 分类 / 原链接。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/ske_social_tagging.py "{\"input_path\":\"./uploads/ske.csv\",\"text_col\":\"文本\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - input_path (必需): 待处理文件路径，支持 .xlsx / .csv。用户在对话里上传的附件通常为 `./uploads/<filename>`。
  - text_col: 作为分析源的列名，默认「文本」。找不到该列且仅有一列时自动用第一列。
  - prompt: 可选。覆盖默认 SKE 社媒提示词。自定义时建议同时传 output_columns。
  - output_columns: 可选。要生成的列名数组（或逗号分隔字符串）。默认 `["media","date","author","sentiment","summary","分类","原链接"]`。
  - sheet: 可选。xlsx 的 sheet 名，默认第一个。
  - max_workers: 可选。并发数 1–16，默认 8。
  - max_rows: 可选。只处理前 N 行（调试用）。
  - year: 可选。覆盖「当前年」，默认系统年份。
  - export_dir: 可选。导出目录，默认 `./workspace`。
【环境变量】:
  - DEEPSEEK_API_KEY (必需)
  - DEEPSEEK_BASE_URL / DEEPSEEK_MODEL (可选)
【默认提示词要点】:
  - media：从指定列第一个超链接识别主域名，映射 Instagram / Facebook / X(Twitter) / Tumblr / Youtube / Reddit / Bluesky；t.co、twitter.com → X(Twitter)；无法识别 → Reddit。
  - date：提取第一个日期为 YYYY-MM-DD，年份为当前年。
  - author：只取作者名（@ 之后）；media 不在上述平台且抽不出作者 → Forum User。
  - sentiment：positive / negative / neutral。
  - summary：只保留含 SKE / Hayati / Vaporesso / RELX / Geek Bar / Elfbar 之一的完整语句，非英语译成英文，不含来源/日期/作者。
  - 分类：命中上述品牌关键字取一个，未命中为空。
  - 原链接：提取全部链接或域名，http(s) 原样保留不展开短链；多个用 `, ` 分隔；没有则「无」。
【返回格式】: JSON。成功: {"ok": true, "data": {"output_xlsx","output_csv","rows","errors","text_col","columns_added","note"}}；失败: {"ok": false, "error", "hint"}。
  - 产物文件写在 ./workspace，系统会注入 produced_files 并在界面显示下载按钮。回复里只报文件名，禁止编造完整下载 URL。
【使用注意】:
  - 用户上传附件后，Master 可直接执行本技能（不必转 Sub）。缺列名或提示词时先问清楚。
  - 原表已有同名生成列时会被覆盖。
  - 进度打到 stderr，不污染 stdout JSON。
