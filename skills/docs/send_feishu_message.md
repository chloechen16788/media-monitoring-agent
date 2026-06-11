【功能】: 向目标人发送飞书工作台通知消息。
【调用方式】: python skills/send_feishu_message.py --target "<目标人>" --message "<消息内容>"
【参数说明】:
  - --target (必需): 接收人标识，可以是员工ID或者特定称谓（如 "manager" 代表直属主管）。
  - --message (必需): 飞书消息的具体内容。
【返回格式】: 发送成功或失败的提示。
