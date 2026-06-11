import json
import urllib.request
import urllib.error
import traceback
from datetime import datetime

ES_URL = "http://139.198.17.239:9203"
# INDEX_NAME will be built dynamically using uid and partition


def _month_of(time_str) -> str | None:
    """从时间字符串（YYYY-MM-DD ...）推导月份分区 YYYYMM。"""
    try:
        return datetime.strptime(str(time_str).strip()[:10], "%Y-%m-%d").strftime("%Y%m")
    except (ValueError, TypeError):
        return None


def resolve_partition(params: dict):
    """返回 (partition, error_json)。显式传入优先；否则按 start_time 月份推导。

    ES 按月分库（索引名 {uid}_{partition}），partition 必须与查询时间段同月，
    否则会出现“查询成功但 0 条数据”。跨月查询必须按月拆分多次调用。
    """
    explicit = str(params.get("partition") or "").strip()
    if explicit:
        return explicit, None
    start_month = _month_of(params.get("start_time"))
    end_month = _month_of(params.get("end_time"))
    if not start_month:
        return None, json.dumps({"error": "无法从 start_time 推导 partition，请检查时间格式（YYYY-MM-DD HH:MM:SS）或显式传入 partition。"})
    if end_month and end_month != start_month:
        return None, json.dumps({
            "error": f"start_time({start_month}) 与 end_time({end_month}) 跨月。ES 按月分库，单次调用只能查一个月份分区。",
            "hint": "请按月拆分为多次独立调用，或显式指定 partition。",
        })
    return start_month, None


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

    task_ids = params.get("task_ids", [])
    start_time = params.get("start_time")
    end_time = params.get("end_time")
    keywords = params.get("keywords", "")
    size = int(params.get("size", 20))
    sentiment_filter = params.get("sentiment_filter")
    
    if not task_ids or not start_time or not end_time:
        return json.dumps({"error": "缺少必要的参数: task_ids, start_time, end_time"})

    partition, partition_error = resolve_partition(params)
    if partition_error:
        return partition_error
    index_name = f"{uid}_{partition}"
        
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
