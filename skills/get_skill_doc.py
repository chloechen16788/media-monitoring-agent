import sys
import json
import os

DOCS = {
    "query_reimbursement_policy": """
【技能名称】: query_reimbursement_policy
【功能】: 在公司知识库中检索差旅、打车、加班、休假等规章制度。
【调用方式】: python /Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/query_reimbursement_policy.py "<检索关键词>"
【参数说明】:
  - 检索关键词 (必需): 纯文本形式的查询语句，例如 "晚上打车报销规定" 或 "出差住宿标准"
【返回格式】: 包含检索到的规定内容的纯文本片段。
""",
    "check_reimbursement_progress": """
【技能名称】: check_reimbursement_progress
【功能】: 查询指定员工当前最新的报销单审批进度状态。
【调用方式】: python /Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/check_reimbursement_progress.py --user_id <员工ID>
【参数说明】:
  - --user_id (必需): 员工的工号或唯一ID (如 "1001")
【返回格式】: 纯文本形式的状态描述，如 "您的打车报销单正在 [部门主管-张三] 审批中"
""",
    "send_feishu_message": """
【技能名称】: send_feishu_message
【功能】: 向目标人发送飞书工作台通知消息。
【调用方式】: python /Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/send_feishu_message.py --target "<目标人>" --message "<消息内容>"
【参数说明】:
  - --target (必需): 接收人标识，可以是员工ID或者特定称谓（如 "manager" 代表直属主管）。
  - --message (必需): 飞书消息的具体内容。
【返回格式】: 发送成功或失败的提示。
""",
    "es_agg_search": """
【技能名称】: es_agg_search
【功能】: 查询宏观图表数据（如品牌声量、情感分布、各渠道趋势等）。通过分析结果回答关于“趋势解读”、“情绪洞察”、“渠道分布”等问题。
【调用方式】: python /Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/es_agg_search.py '{"task_ids": [6860], "start_time": "2026-04-24 00:00:00", "end_time": "2026-04-30 23:59:59", "dimensions": ["sov", "sentiment"]}'
【参数说明】 (以 JSON 字符串形式传入):
  - uid (必需): 底层引擎的账户ID，由系统通知提供。
  - partition (必需): 底层引擎的数据分区，由系统通知提供。
  - task_ids (必需): 品牌/任务的ID列表，例如 [6860] (宝马), [6861] (奔驰), [6862] (奥迪), [6863] (MINI)。
  - start_time (必需): 开始时间，如 "2026-04-24 00:00:00"
  - end_time (必需): 结束时间，如 "2026-04-30 23:59:59"
  - dimensions (必需): 字符串数组，可填 ["sov", "trend", "channel", "sentiment", "source", "effect_agg"]，获取所需的维度数据。
【返回格式】: JSON 格式的数据统计结果。
""",
    "es_sample_search": """
【技能名称】: es_sample_search
【功能】: 抽取微观热门文章样本。当你需要分析具体的爆发点、爆款文章内容、或提炼负面事件时调用。
【调用方式】: python /Users/Zhuanz/.gemini/antigravity/scratch/my-company-agent/skills/es_sample_search.py '{"task_ids": [6860], "start_time": "2026-04-24 00:00:00", "end_time": "2026-04-30 23:59:59", "size": 10}'
【参数说明】 (以 JSON 字符串形式传入):
  - uid (必需): 底层引擎的账户ID，由系统通知提供。
  - partition (必需): 底层引擎的数据分区，由系统通知提供。
  - task_ids (必需): 品牌/任务的ID列表，例如 [6860] (宝马)。
  - start_time (必需): 开始时间。
  - end_time (必需): 结束时间。
  - size: 提取的文章数量，默认为 20。
  - keywords: 可选。用于过滤特定关键词的文章。
  - sentiment_filter: 可选。传入 -1 获取纯负面，1 获取纯正面。
【返回格式】: 包含原文片段、媒体来源和互动量的热门文章 JSON 列表。
"""
}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python get_skill_doc.py <skill_id>")
        sys.exit(1)
        
    skill_id = sys.argv[1]
    if skill_id == "advanced_chart_sampling":
        schema_path = os.path.join(os.path.dirname(__file__), "chart_sampling_schema.md")
        if os.path.exists(schema_path):
            with open(schema_path, 'r', encoding='utf-8') as f:
                print(f.read())
        else:
            print("错误: 找不到 chart_sampling_schema.md 文件。")
    elif skill_id in DOCS:
        print(DOCS[skill_id])
    else:
        print(f"错误: 找不到技能 '{skill_id}'。请查阅 catalog.json 获取正确的技能ID。")
        sys.exit(1)
