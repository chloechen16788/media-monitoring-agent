【功能】: 读取一个 JSONL 批次，调用标注模型（默认 Gemini，走 Google 原生 generateContent 接口，QPS 高；备用 gateway OpenAI 兼容网关；预留 local 扩展）对每条做 BMW“高价值硬核科技新闻”判定，写回 annotated JSONL（原字段全保留 + 标注字段横向追加）。标注模型仅本 skill 内部调用，不用于对话。完整流程见 bmw_tagging 说明书。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/bmw_tag_jsonl.py "{\"manifest_path\":\"./workspace/bmw_demo/manifest.json\",\"provider\":\"gemini\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - input_jsonl: 可选。待标注的 JSONL 批次路径（由 es_export_jsonl_batches 生成）。
  - output_jsonl: 可选。标注结果输出路径。
  - title_field: 标题字段名，默认 "title"。
  - input_text_mode: 标注输入文本模式，默认 "blurb"；可选 "content"（显式要求时使用标题+正文）。
    - blurb 模式会按 30 条/批调用一次模型（输出仍按单条写回，字段不变）。
  - blurb_field: 摘要字段名，默认 "blurb"（`input_text_mode="blurb"` 时生效）。
  - content_field: 正文字段名，默认 "content_snippet"（`input_text_mode="content"` 时生效）。
  - content_max_chars: 正文模式截断上限，默认 2000（0 表示不截断；仅 `input_text_mode="content"` 生效）。
  - provider: 标注模型来源，"gemini"(默认，Google 原生 API，QPS 高) | "gateway"(OpenAI 兼容网关，备用) | "local"(预留)。
  - max_workers: 并发数，上限 64；默认值按模式自适应：blurb=2、content=23。
  - max_records: 单批最大条数（成本围栏），默认 1500，超出报错要求分批。
  - progress_file: 可选。进度写入路径（旁路文件，不打 stdout），形如 {"done","total","ok","fail"}。
  - manifest_path: 可选。若提供可自动定位批次并回写状态。
  - batch_id: 可选。配合 manifest_path 指定处理某个批次；不传则自动选择第一个 status=exported 的批次。
  - prompt_override: 可选。覆盖单条判定 prompt 模板（主要用于 `input_text_mode="content"`）。
  - batch_prompt_override: 可选。覆盖批量判定 prompt 模板（主要用于 `input_text_mode="blurb"`）。
【性能与稳定性默认值】:
  - `input_text_mode="blurb"`：默认 30 条/批、并发 2（避免超时）。
  - `input_text_mode="content"`：默认并发 23（单条模式）。
  - 接口超时默认 120s（环境变量 `SKILL_TAGGING_TIMEOUT_SEC` 可调，范围 30~300）。
【环境变量】(标注模型隔离):
  gemini provider（默认，Google 原生 generateContent，URL 形如 {BASE_URL}/v1beta/models/{MODEL}:generateContent?key={API_KEY}）:
  - SKILL_TAGGING_API_KEY (必需): Google API Key。
  - SKILL_TAGGING_BASE_URL: 默认 https://generativelanguage.googleapis.com。
  - SKILL_TAGGING_MODEL: 默认 gemini-2.0-flash。
  - SKILL_TAGGING_PROXY: 可选，需要翻墙时设代理（如 http://127.0.0.1:7890），直连留空。
  gateway provider（备用，OpenAI 兼容网关）:
  - SKILL_TAGGING_GATEWAY_URL / SKILL_TAGGING_GATEWAY_MODEL (必需), SKILL_TAGGING_GATEWAY_API_KEY / SKILL_TAGGING_ENV (可选)。
【返回格式】: JSON。成功: {"ok": true, "data": {"input_jsonl","output_jsonl","provider","input_text_mode","total","succeeded","failed","label_distribution"}}；失败: {"ok": false, "error", "hint"}。
  - 标注字段: is_important_tech_news(是/否) / reason / tech_category / location / subject。
  - 429 自动指数退避重试；非 200 与解析失败均落为可识别的标注值（错误/异常/解析失败），不中断整批。
  - 写入采用临时文件 + 原子 rename。

【示例 - 用 gateway 备用通道（OpenAI 兼容）】:
python skills/executor/bmw_tag_jsonl.py "{\"manifest_path\":\"./workspace/bmw_demo/manifest.json\",\"provider\":\"gateway\",\"max_workers\":4}"

【示例 - 显式切到标题+正文2000字】:
python skills/executor/bmw_tag_jsonl.py "{\"manifest_path\":\"./workspace/bmw_demo/manifest.json\",\"provider\":\"gemini\",\"input_text_mode\":\"content\",\"content_max_chars\":2000}"
