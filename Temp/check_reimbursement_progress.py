import argparse

def check_progress(user_id):
    # Mock data for demonstration
    status_db = {
        "1001": "【进行中】您的 300 元打车报销单正在 [部门主管-张三] 审批中。",
        "1002": "【已驳回】打车报销单缺少电子发票，请补充后重新提交。",
        "1003": "【已完成】报销款已打入您的工资卡。"
    }
    return status_db.get(user_id, "【未知】未找到该员工近期的报销记录。")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="查询报销进度")
    parser.add_argument("--user_id", required=True, help="员工工号")
    args = parser.parse_args()
    
    status = check_progress(args.user_id)
    print(status)
