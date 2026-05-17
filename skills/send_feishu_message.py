import argparse
import time

def send_message(target, message):
    # Mock sending Feishu message
    print(f"📡 正在通过 Feishu API 发送消息...")
    time.sleep(1) # Simulate network delay
    print(f"✅ 发送成功！\n【目标】: {target}\n【内容】: {message}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="发送飞书消息")
    parser.add_argument("--target", required=True, help="目标人标识符 (如员工ID或 manager)")
    parser.add_argument("--message", required=True, help="发送的具体消息内容")
    args = parser.parse_args()
    
    send_message(args.target, args.message)
