【功能】: 用 TikHub 按关键词搜小红书笔记，先取搜索结果、按 note_id 去重、提取字段，无标题时才按图文/视频调详情，再按作者调 get_user_info 补粉丝数，导出 Excel（无阅读数、无正文列）。只要列表不要粉丝时改用 xiaohongshu_keyword_search_nofans。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/xiaohongshu_keyword_search.py "{\"keywords\":\"呼和浩特美食推荐\",\"pages\":10}"
【参数说明】 (以 JSON 字符串形式传入):
  - keywords (必需): 关键词字符串或数组。多个词用逗号/换行/分号分隔，可并发检索。
  - pages: 每个关键词页数，默认 10，范围 1–20。未指定时用 10 并告知用户。
  - workers: 关键词并发，默认 5，上限 10（TikHub 默认 10 QPS）。
  - filename: 可选。只要文件名，不要路径。未带 .xlsx 时自动补上。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - SKILL_TIKHUB_API_KEY (必需)
  - SKILL_TIKHUB_BASE_URL (必需，如 https://api.tikhub.dev)
  - SKILL_TIKHUB_PROXY (可选，如 http://127.0.0.1:7890；59 生产必须走本机代理)
【固定约定】:
  - sort_type=general，note_type=不限，time_filter=不限
  - 同一关键词翻页串行；多关键词可并发
  - 媒体类型只用搜索列表 type（video→短视频）
  - 粉丝数走 get_user_info（$0.01/作者，通常是最大开销）；阅读数不导出
【返回格式】: JSON。成功含 `cost.table` / `cost.total_usd`。回复必须贴出金额表，只报文件名。
  - 中途 402/余额不足：若已有部分结果，仍导出 Excel，`partial=true`；0 条才失败。
  - 产物写在 ./workspace，系统注入 produced_files。禁止编造完整下载 URL。
【使用注意】:
  - 缺关键词时先问或发 PARAM_REQUEST。
  - 只要列表不要粉丝：xiaohongshu_keyword_search_nofans。需要正文：xiaohongshu_keyword_search_fulltext。
  - 已有笔记链接、不要关键词搜索：xiaohongshu_note_detail_by_links。
