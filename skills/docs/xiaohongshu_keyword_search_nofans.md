【功能】: 用 TikHub 按关键词搜小红书笔记，按 note_id 去重后导出 Excel（无正文、无粉丝数、无阅读数）。不调用 get_user_info，成本通常只有检索页数 × $0.01，另加少量空标题补详情。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/xiaohongshu_keyword_search_nofans.py "{\"keywords\":\"新疆美食\",\"pages\":10}"
【参数说明】 (以 JSON 字符串形式传入):
  - keywords (必需): 关键词字符串或数组。多个词用逗号/换行/分号分隔，可并发检索。
  - pages: 每个关键词页数，默认 10，范围 1–20。
  - workers: 关键词并发，默认 5，上限 10。
  - filename: 可选。只要文件名，不要路径。未带 .xlsx 时自动补上。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - SKILL_TIKHUB_API_KEY (必需)
  - SKILL_TIKHUB_BASE_URL (必需，如 https://api.tikhub.dev)
  - SKILL_TIKHUB_PROXY (可选，如 http://127.0.0.1:7890；59 生产必须走本机代理)
【固定约定】:
  - 与无正文技能相同的检索/去重/媒体类型规则
  - Excel 不含粉丝数、正文、阅读数
  - 只要列表、不提粉丝时优先用本技能
【返回格式】: JSON。成功含 `cost.table`（Markdown 金额表）和 `cost.total_usd`。回复必须贴出该表，并只报文件名。
  - 中途 402：有部分结果仍导出；0 条才失败不写文件。
【使用注意】:
  - 缺关键词时先问。需要粉丝用 xiaohongshu_keyword_search；需要正文用 xiaohongshu_keyword_search_fulltext。
  - 已有笔记链接、不要关键词搜索：xiaohongshu_note_detail_by_links。
  - 按博主账号 id 拉该用户笔记：xiaohongshu_user_posted_notes。
