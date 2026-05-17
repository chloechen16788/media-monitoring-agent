import os
import sys
# 强制 HuggingFace 离线模式，防止每次加载模型都去请求外网导致 Timeout
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import chromadb
from chromadb.utils import embedding_functions
from FlagEmbedding import FlagReranker
import torch

# 配置模型路径和本地数据库
DB_PATH = os.path.join(os.path.dirname(__file__), "../chroma_db")
EMBEDDING_MODEL_NAME = "BAAI/bge-large-zh-v1.5"
RERANKER_MODEL_NAME = os.path.join(os.path.dirname(__file__), "../models/BAAI/bge-reranker-base")

class EnterpriseRAG:
    def __init__(self):
        print("🚀 正在初始化 Enterprise RAG 系统...")
        # 1. 自动判断是否有苹果 MPS 加速支持
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        print(f"🎯 使用硬件加速引擎: {self.device}")

        # 2. 初始化本地 ChromaDB
        self.chroma_client = chromadb.PersistentClient(path=DB_PATH)
        
        # 3. 加载 BGE Embedding 模型
        print(f"📦 正在加载本地 Embedding 模型: {EMBEDDING_MODEL_NAME}...")
        self.embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL_NAME,
            device=self.device
        )
        
        # 创建或获取集合
        self.collection = self.chroma_client.get_or_create_collection(
            name="company_docs",
            embedding_function=self.embedding_fn
        )

        # 4. 加载 BGE Reranker 模型
        print(f"📦 正在加载本地 Reranker 模型: {RERANKER_MODEL_NAME}...")
        from sentence_transformers import CrossEncoder
        # 使用 sentence_transformers 的 CrossEncoder 替代 FlagReranker 以兼容新版 transformers
        self.reranker = CrossEncoder(RERANKER_MODEL_NAME, device=self.device)
        print("✅ RAG 系统初始化完成！\n")

    def ingest_docs(self, docs, metadatas=None, ids=None):
        """将文档摄入向量库"""
        if not ids:
            ids = [f"doc_{i}" for i in range(len(docs))]
        self.collection.add(
            documents=docs,
            metadatas=metadatas,
            ids=ids
        )
        print(f"✅ 成功插入 {len(docs)} 条文档切片！")

    def search(self, query: str, top_k: int = 5, rerank_top_k: int = 2) -> str:
        """核心检索管道：向量粗排 -> Reranker精排"""
        print(f"🔍 收到检索请求: '{query}'")
        
        # 步骤 1: 向量粗排 (Dense Retrieval)
        # 尝试多召回一些文档用于后续的 Rerank
        results = self.collection.query(
            query_texts=[query],
            n_results=top_k
        )
        
        retrieved_docs = results['documents'][0]
        if not retrieved_docs:
            return "未找到相关文档。"

        print(f"🔎 粗排阶段召回了 {len(retrieved_docs)} 篇文档，准备进行重排...")

        # 步骤 2: Reranker 重排 (Cross-Encoder)
        # 构建 (Query, Doc) 组合
        pairs = [[query, doc] for doc in retrieved_docs]
        scores = self.reranker.predict(pairs)
        
        # 如果只有一个文档，返回的分数不是列表
        if isinstance(scores, float) or scores.ndim == 0:
            scores = [float(scores)]
        else:
            scores = [float(s) for s in scores]

        # 将得分与文档绑定并降序排序
        doc_scores = list(zip(retrieved_docs, scores))
        doc_scores.sort(key=lambda x: x[1], reverse=True)

        # 提取前 rerank_top_k 的文档
        best_docs = doc_scores[:rerank_top_k]
        
        print("🏆 检索与重排完成！得分最高的前两名文档：")
        for doc, score in best_docs:
            print(f"   [得分: {score:.2f}] {doc[:30]}...")

        # 组合成大模型所需的上下文返回
        context = "\n\n".join([f"【内部文档参考】\n{doc}" for doc, _ in best_docs])
        return context

# 如果作为独立脚本运行，用于测试
if __name__ == "__main__":
    import sys
    rag = EnterpriseRAG()
    
    # 初始化一些测试用的 Mock 数据
    if rag.collection.count() == 0:
        print("📝 检测到数据库为空，正在注入测试数据...")
        mock_docs = [
            "公司规定打车报销需要在每月25日前通过钉钉审批流提交，并附带电子发票。",
            "差旅费用的报销标准：一线城市每天最高住宿标准为600元。",
            "员工每天打车上下班不予报销，加班超过晚上10点才可以报销打车费。",
            "请假额度：入职满一年的员工享有每年5天的带薪年假。",
            "IT支持部门的内网服务器IP是 192.168.1.100，如需访问需要连接公司 VPN。"
        ]
        rag.ingest_docs(mock_docs)
    
    if len(sys.argv) > 1:
        query = sys.argv[1]
        result = rag.search(query)
        print("\n最终返回给 Agent 的结果:\n" + result)
    else:
        print("请输入要检索的问题。")
