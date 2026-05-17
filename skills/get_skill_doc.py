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
"""
}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python get_skill_doc.py <skill_id>")
        sys.exit(1)
        
    skill_id = sys.argv[1]
    if skill_id in DOCS:
        print(DOCS[skill_id])
    else:
        print(f"错误: 找不到技能 '{skill_id}'。请查阅 catalog.json 获取正确的技能ID。")
        sys.exit(1)
