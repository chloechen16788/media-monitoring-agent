【功能】: 用 TikHub Reddit APP 按关键词搜帖子，再批量拉帖子详情，并对每个帖子按 NEW 排序翻评论页，导出 Excel（帖子+评论）。只搜帖子，不搜社区/用户/媒体。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/reddit_keyword_search.py "{\"query\":\"tesla\",\"pages\":1}"
【参数说明】 (以 JSON 字符串形式传入):
  - query / keywords (必需): 搜索关键词，字符串或数组。多个词用逗号/换行/分号分隔，可并发。
  - sort: 帖子排序，默认 `NEW`（时间/最新）。可选 `RELEVANCE`（相关）、`HOT`（热门）、`TOP`（最受欢迎）、`NEW`（最新）、`COMMENTS`（评论数）。也可用中文：时间/最新/相关/热门/最受欢迎/评论数。
  - time_range: 时间范围，默认 `month`（近一个月）。可选 `all` / `year` / `month` / `week` / `day` / `hour`。也可用中文：所有时间/年/月/周/今天/小时。
  - pages: 每个关键词的搜索翻页数，默认 1，范围 1–20。每页约 7 条。未指定时用 1 并告知用户。
  - comment_pages: 每个帖子的评论翻页数，默认 2，范围 1–5。评论固定 `sort_type=NEW`。
  - workers: 多关键词搜索与评论拉取并发，默认 5，上限 10。
  - filename: 可选。只要文件名，不要路径。未带 .xlsx 时自动补上。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - SKILL_TIKHUB_API_KEY (必需)
  - SKILL_TIKHUB_BASE_URL (必需，如 https://api.tikhub.dev)
  - SKILL_TIKHUB_PROXY (可选，如 http://127.0.0.1:7890；59 生产必须走本机代理)
【固定约定】:
  - 第一步只搜帖子：GET `/api/v1/reddit/app/fetch_dynamic_search`，`search_type=post`，`safe_search=unset`，`allow_nsfw=0`
  - 搜索翻页传上页 `pageInfo.endCursor` 到 `after`；`hasNextPage=false` 或空列表则停
  - 第二步批量详情：GET `/api/v1/reddit/app/fetch_post_details_batch_large`，帖子 ID 带 `t3_` 前缀，每批最多 30 条
  - 第三步评论：GET `/api/v1/reddit/app/fetch_post_comments`，`sort_type=NEW`，翻页用 `trees[-1].more.cursor`，每个帖默认 2 页。不调用二级评论接口
  - Excel 列（顺序不变）：日期 / 标题 / 内容 / 链接 / 作者 / 类型（帖子或评论） / 互动数（score）
  - 每个帖子先写 1 行帖子，再写其评论；评论的「标题」用所属帖标题
  - 互动数取 `score`（点赞/upvote），不是评论数
【返回格式】: JSON。成功含 `cost.table` / `cost.total_usd`。回复必须贴出金额表，只报文件名。
  - 中途 402：有部分结果仍导出；0 条帖子才失败不写文件。
  - 产物写在 ./workspace，系统注入 produced_files。禁止编造完整下载 URL。
【使用注意】:
  - 缺关键词时先问或发 PARAM_REQUEST。未指定 sort / time_range / pages 时分别用 NEW / month / 1。
  - 评论页数按帖子计费，页数和帖子数上去后费用会明显增加。
