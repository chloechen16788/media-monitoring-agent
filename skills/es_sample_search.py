import json
import urllib.request
import urllib.error
import traceback

ES_URL = "http://139.198.17.239:9203"
# INDEX_NAME will be built dynamically using uid and partition

def _resolve_content(source: dict) -> str:
    for key in ("messageContent", "content", "newsContent", "messageText"):
        val = source.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""

def execute(params: dict) -> str:
    """
    执行基于 Fingerprint 的去重高赞文章抽样。
    
    期望参数 (params):
    - task_ids: list[int] - 相关的任务 ID 列表
    - start_time: str - 开始时间 (YYYY-MM-DD HH:MM:SS)
    - end_time: str - 结束时间 (YYYY-MM-DD HH:MM:SS)
    - keywords: str - 过滤关键词 (可选)
    - size: int - 提取的事件/文章数量 (默认 20)
    - uid: str/int - 用户 ID
    - partition: str - 索引分区月份 (e.g. "202604")
    - sentiment_filter: int - 强制情感过滤 (如 -1 代表仅抽取负面)
    """
    uid = params.get("uid", "134209751")
    partition = params.get("partition", "202512")
    index_name = f"{uid}_{partition}"
    
    task_ids = params.get("task_ids", [])
    start_time = params.get("start_time")
    end_time = params.get("end_time")
    keywords = params.get("keywords", "")
    size = int(params.get("size", 20))
    sentiment_filter = params.get("sentiment_filter")
    
    if not task_ids or not start_time or not end_time:
        return json.dumps({"error": "缺少必要的参数: task_ids, start_time, end_time"})
        
    try:
        url = f"{ES_URL}/{index_name}/_search"
        
        must_filters = [
            {"terms": {"taskId": task_ids}},
            {"term": {"isDeleted": False}},
            {"range": {
                "messageTime": {
                    "gte": start_time,
                    "lte": end_time
                }
            }}
        ]
        
        if keywords:
            must_filters.append({
                "multi_match": {
                    "query": keywords,
                    "fields": ["messageTitle", "messageContent"]
                }
            })
            
        if sentiment_filter is not None:
            must_filters.append({
                "term": {"sentiment": int(sentiment_filter)}
            })
            
        payload = {
            "size": 0,
            "query": {
                "bool": {
                    "filter": must_filters
                }
            },
            "aggs": {
                "cluster_list": {
                    "terms": {
                        "field": "finger",
                        "size": size,
                        "order": {"_count": "desc"}
                    },
                    "aggs": {
                        "top_articles_by_prn": {
                            "top_hits": {
                                "size": 1,
                                "_source": [
                                    "messageTitle",
                                    "messageTime",
                                    "mediaName",
                                    "messageUrl",
                                    "prn",
                                    "finger",
                                    "messageContent",
                                    "taskId"
                                ],
                                "sort": [{"prn": {"order": "desc"}}]
                            }
                        }
                    }
                }
            }
        }
        
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
        buckets = data.get("aggregations", {}).get("cluster_list", {}).get("buckets", [])
        
        results = []
        for b in buckets:
            hits = b.get("top_articles_by_prn", {}).get("hits", {}).get("hits", [])
            if not hits:
                continue
                
            source = hits[0].get("_source", {})
            
            # 清洗内容，截断前 1500 个字符以防大模型 Token 撑爆
            raw_content = _resolve_content(source)
            clean_content = raw_content[:1500] + "..." if len(raw_content) > 1500 else raw_content
            
            results.append({
                "taskId": source.get("taskId"),
                "title": source.get("messageTitle", ""),
                "media": source.get("mediaName", ""),
                "time": source.get("messageTime", ""),
                "fingerprint_cluster_size": b["doc_count"], # 传播热度
                "content_snippet": clean_content
            })
            
        return json.dumps({"status": "success", "extracted_count": len(results), "articles": results}, ensure_ascii=False, indent=2)
        
    except Exception as e:
        err_msg = traceback.format_exc()
        return json.dumps({"error": f"ES抽样查询失败: {str(e)}", "details": err_msg})

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        try:
            params = json.loads(sys.argv[1])
            print(execute(params))
        except Exception as e:
            print(json.dumps({"error": f"Failed to parse JSON parameters: {str(e)}"}))
    else:
        print(json.dumps({"error": "Missing JSON parameters"}))
