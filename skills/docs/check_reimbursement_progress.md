【功能】: 查询指定员工当前最新的报销单审批进度状态。
【调用方式】: python skills/check_reimbursement_progress.py --user_id <员工ID>
【参数说明】:
  - --user_id (必需): 员工的工号或唯一ID (如 "1001")
【返回格式】: 纯文本形式的状态描述，如 "您的打车报销单正在 [部门主管-张三] 审批中"
