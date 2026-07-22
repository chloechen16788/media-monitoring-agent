import json
from skills import es_agg_search, es_sample_search

print("="*50)
print("开始测试真实 ES 聚合引擎 (es_agg_search)...")
print("="*50)

# 1. 组装聚合参数
agg_params = {
    "uid": "134209751",
    "partition": "202604",
    "task_ids": [6860],
    "start_time": "2026-04-01 00:00:00",
    "end_time": "2026-04-30 23:59:59",
    "dimensions": ["sov", "trend", "channel", "sentiment"]
}

try:
    print(f"请求参数: {json.dumps(agg_params, ensure_ascii=False)}")
    agg_result_str = es_agg_search.execute(agg_params)
    agg_result = json.loads(agg_result_str)
    
    print(f"\n[聚合返回] 总命中数: {agg_result.get('total_hits')}")
    print("[聚合返回] SOV 数据:", json.dumps(agg_result.get("aggs", {}).get("sov"), ensure_ascii=False, indent=2))
    print("[聚合返回] 情感分布 (展示第一个任务):", json.dumps(agg_result.get("aggs", {}).get("sentiment", {}).get("6860"), ensure_ascii=False, indent=2))
except Exception as e:
    print(f"聚合请求失败: {e}")

print("\n" + "="*50)
print("开始测试真实 ES 指纹去重抽样引擎 (es_sample_search)...")
print("="*50)

# 2. 组装抽样参数
sample_params = {
    "uid": "134209751",
    "partition": "202604",
    "task_ids": [6860],
    "start_time": "2026-04-01 00:00:00",
    "end_time": "2026-04-30 23:59:59",
    "size": 1000
}

try:
    print(f"请求参数: {json.dumps(sample_params, ensure_ascii=False)}")
    sample_result_str = es_sample_search.execute(sample_params)
    sample_result = json.loads(sample_result_str)
    
    articles = sample_result.get("articles", [])
    print(f"\n[抽样返回] 成功提取到去重独立事件/文章数: {sample_result.get('extracted_count')}")
    
    if articles:
        print("\n展示传播热度 (fingerprint_cluster_size) Top 3 的代表作：")
        for i, doc in enumerate(articles[:3]):
            print(f"\n--- Top {i+1} ---")
            print(f"标题: {doc.get('title')}")
            print(f"发布时间: {doc.get('time')} | 媒体: {doc.get('media')} | 相同新闻/评论数: {doc.get('fingerprint_cluster_size')}")
            content = doc.get("content_snippet", "")
            print(f"内容摘要: {content[:100]}...")
except Exception as e:
    print(f"抽样请求失败: {e}")
