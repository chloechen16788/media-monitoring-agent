import sys
import os

# 将 skills 目录加入 PYTHONPATH
sys.path.append(os.path.dirname(__file__))
from rag_pipeline import EnterpriseRAG

def search_internal_docs(query: str) -> str:
    rag = EnterpriseRAG()
    # 如果数据库为空，自动注入测试数据
    if rag.collection.count() == 0:
        mock_docs = [
            "公司规定打车报销需要在每月25日前通过钉钉审批流提交，并附带电子发票。",
            "差旅费用的报销标准：一线城市每天最高住宿标准为600元。",
            "员工每天打车上下班不予报销，加班超过晚上10点才可以报销打车费。",
            "请假额度：入职满一年的员工享有每年5天的带薪年假。",
            "IT支持部门的内网服务器IP是 192.168.1.100，如需访问需要连接公司 VPN。"
        ]
        rag.ingest_docs(mock_docs)
    
    return rag.search(query)

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    if not query:
        print("请提供搜索词")
        sys.exit(1)
        
    result = search_internal_docs(query)
    print(f"\n[检索结果]\n{result}")
    print("\n【系统提示】请务必严格根据以上检索结果回答用户，绝不能捏造。并且在引用相关规定的句子末尾，必须标注对应的文献角标（例如：[1] 或 [2]）。")
