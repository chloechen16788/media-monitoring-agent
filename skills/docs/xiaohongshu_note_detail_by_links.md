【功能】: 读取上传的 Excel/CSV 中的笔记链接列，提取 note_id（或用短链 share_text），逐条调用 TikHub `get_image_note_detail` / `get_video_note_detail`，把点赞/收藏/评论/转发写回原表并导出。不搜索关键词，默认不拉粉丝、不补正文。一个技能完成读表→抽 ID→调详情→写回，不要再调 read_tabular_data / write_tabular_data / 关键词搜索。
【调用方式】: 必须严格以 JSON 字符串形式传入参数，禁止使用单引号。示例: python skills/executor/xiaohongshu_note_detail_by_links.py "{\"input_path\":\"./uploads/notes.xlsx\",\"link_col\":\"笔记链接\"}"
【参数说明】 (以 JSON 字符串形式传入):
  - input_path (必需): 待处理文件路径，支持 .xlsx / .csv。用户上传附件通常为 `./uploads/<filename>`。
  - link_col: 可选。笔记链接列名。不传则按「笔记链接 / 地址 / 链接 / url」等自动识别。
  - sheet: 可选。xlsx 的 sheet 名，默认第一个。
  - with_body: 可选。默认 false。true 时额外写「正文」列（来自详情 desc）。
  - with_fans: 可选。默认 false。true 时再调 get_user_info 写「粉丝数」（更贵）。
  - workers: 可选。详情并发，默认 5，上限 10。
  - max_rows: 可选。只处理前 N 行（调试）。
  - filename: 可选。只要文件名，不要路径。未带 .xlsx 时自动补上。
  - export_dir: 可选。默认 `./workspace`。
【环境变量】:
  - SKILL_TIKHUB_API_KEY (必需)
  - SKILL_TIKHUB_BASE_URL (必需，如 https://api.tikhub.dev)
  - SKILL_TIKHUB_PROXY (可选，如 http://127.0.0.1:7890；59 生产必须走本机代理)
【固定约定】:
  - 从 explore / discovery/item / note / profile 路径或 24 位 hex 提取 note_id；短链 xhslink 走 share_text
  - 默认先调图文详情，失败再调视频详情；URL 含 video 则先视频
  - 写回列：note_id（或原表「笔记id」）/ 点赞数 / 收藏数 / 评论数 / 分享数或转发数 / 类型或媒体类型 / 详情状态；原表已有同名列则覆盖
  - 若表中有「类型」为视频/短视频，优先调视频详情，避免多花一次图文费用
  - 同一 note_id 只调一次详情，结果填回所有重复行
  - 默认不调用 get_user_info；阅读数不导出
【返回格式】: JSON。成功含 `cost.table` / `cost.total_usd`。回复必须贴出金额表，只报文件名。
  - 中途 402/余额不足：若已有部分结果，仍导出 Excel，`partial=true`。
  - 产物写在 ./workspace，系统注入 produced_files。禁止编造完整下载 URL。
【使用注意】:
  - 缺文件路径或找不到链接列时先问或发 PARAM_REQUEST。
  - 用户只要看某一列原文：用 read_tabular_data，不要用本技能。
  - 用户要按关键词搜索笔记：用 xiaohongshu_keyword_search_nofans 等，不要用本技能。
