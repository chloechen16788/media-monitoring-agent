【功能】: 按小红书博主账号 id（或主页/分享链接）拉取该用户已发布笔记列表，游标翻页，按 note_id 去重后导出 Excel。列与关键字搜索（无正文无粉丝）相同：时间/来源/作者号/媒体类型/标题/地址/摘要/转发数/评论数/点赞数/收藏数/搜索关键词（填博主 id）。不调详情、不拉粉丝。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/xiaohongshu_user_posted_notes.py "{\"user_id\":\"61b46d790000000010008153\",\"pages\":10}"
【参数说明】 (以 JSON 字符串形式传入):
  - user_id / user_ids (必需，与 share_text 二选一): 博主账号 id，字符串或数组。多个 id 用逗号/换行/分号分隔，可并发。也支持 `xiaohongshu.com/user/profile/<id>` 主页链接。
  - share_text: 可选。无 user_id 时用小红书分享链接（含 xhslink.com / xhslink.cn）。与 user_id 同时传则以 user_id 为准。
  - pages: 每个账号翻页数，默认 10，范围 1–50。未指定时用 10 并告知用户。每页约 20 条。
  - workers: 多账号并发，默认 5，上限 10。
  - filename: 可选。只要文件名，不要路径。未带 .xlsx 时自动补上。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - SKILL_TIKHUB_API_KEY (必需)
  - SKILL_TIKHUB_BASE_URL (必需，如 https://api.tikhub.dev)
  - SKILL_TIKHUB_PROXY (可选，如 http://127.0.0.1:7890；59 生产必须走本机代理)
【固定约定】:
  - 接口: GET `/api/v1/xiaohongshu/app_v2/get_user_posted_notes`
  - 首次 cursor 留空；翻页传上页 `notes[-1].cursor`；`has_more=false` 或空列表则停
  - 错误或不存在的 user_id 仍会 HTTP 200 并计费，检测到「服务异常」立即停止该账号后续翻页
  - 不调用 get_image/video_note_detail，不调用 get_user_info；无正文列、无粉丝列、无阅读数
  - 互动数取列表字段：点赞 `likes`（不要用 `nice_count`）、评论 `comments_count`、收藏 `collected_count`、转发 `share_count`
  - 「搜索关键词」列写入博主 id，便于对照来源账号
【返回格式】: JSON。成功含 `cost.table` / `cost.total_usd`。回复必须贴出金额表，只报文件名。
  - 中途 402：有部分结果仍导出；0 条才失败不写文件。
  - 产物写在 ./workspace，系统注入 produced_files。禁止编造完整下载 URL。
【使用注意】:
  - 缺账号 id 时先问或发 PARAM_REQUEST。未指定页数默认 10 页。
  - 按关键词搜笔记用 xiaohongshu_keyword_search_nofans；按笔记链接补互动用 xiaohongshu_note_detail_by_links。
