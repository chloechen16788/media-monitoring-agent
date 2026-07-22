from mcp.server.fastmcp import FastMCP

# 创建一个名为 company-vector-db 的 MCP 服务器
mcp = FastMCP("company-vector-db")

@mcp.tool()
def search_internal_docs(query: str, limit: int = 3) -> str:
    """
    搜索公司内部知识库和文档。
    当你需要回答公司业务、报交流程、技术规范等内部问题时，必须调用此工具。
    
    Args:
        query: 用户的搜索词或自然语言问题
        limit: 返回的文档片段数量
    """
    # ---------------------------------------------------------
    # 这里接入你的真实向量库逻辑 (例如 Milvus, Qdrant, Chroma 等)
    # results = vector_db.search(query, top_k=limit)
    # return "\n\n".join([f"文档片段: {r.text}" for r in results])
    # ---------------------------------------------------------
    
    print(f"正在向量库中搜索: {query}")
    
    # 这是一个 Mock 返回测试
    return f"这是关于 '{query}' 的内部文档检索结果：公司规定打车报销需要在每月25日前通过审批流提交，并附带电子发票。"

if __name__ == "__main__":
    # 以 stdio 模式运行 MCP server
    mcp.run()
