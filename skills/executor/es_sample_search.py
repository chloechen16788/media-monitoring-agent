import json
import urllib.request
import urllib.error
import traceback
import os
from datetime import datetime
import sys

ES_URL = "http://139.198.17.239:9203"
# INDEX_NAME will be built dynamically using uid and partition

DATA_CHANNEL_MAP = {
    # 星光编码
    105: "网媒资讯", 106: "论坛", 107: "博客", 108: "微博",
    109: "平媒", 110: "微信", 111: "视频", 112: "资讯APP",
    113: "论坛评论", 114: "长微博", 121: "短视频",
    51: "微博原帖", 95: "搜索引擎", 0: "未知",
    # 清博编码（兼容 int 与字符串零填充）
    1: "新闻", 2: "论坛", 3: "博客", 4: "微博", 5: "平媒",
    6: "微信", 7: "视频", 8: "长微博", 9: "APP", 10: "评论",
    11: "短视频", 99: "搜索引擎",
    "01": "新闻", "02": "论坛", "03": "博客", "04": "微博", "05": "平媒",
    "06": "微信", "07": "视频", "08": "长微博", "09": "APP", "10": "评论",
    "11": "短视频", "99": "搜索引擎",
}


def resolve_channel_name(channel_id) -> str:
    if channel_id in DATA_CHANNEL_MAP:
        return DATA_CHANNEL_MAP[channel_id]
    key = str(channel_id).strip()
    if key in DATA_CHANNEL_MAP:
        return DATA_CHANNEL_MAP[key]
    if key.isdigit():
        numeric = int(key)
        if numeric in DATA_CHANNEL_MAP:
            return DATA_CHANNEL_MAP[numeric]
        key2 = f"{numeric:02d}"
        if key2 in DATA_CHANNEL_MAP:
            return DATA_CHANNEL_MAP[key2]
    return f"未知渠道({channel_id})"

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


def _to_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


def _atomic_write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _write_jsonl(path: str, rows: list[dict]) -> str:
    payload = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    if payload:
        payload += "\n"
    _atomic_write(path, payload)
    return os.path.abspath(path)


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
    - channel_filter: int or list[int] - 按渠道 ID 过滤 (如 108 代表微博，支持单值或数组)
    - output_jsonl: 可选。若传入则把结果写入 JSONL 文件（每行一条）并返回 file_path
    - include_articles: 可选。是否在 stdout 返回 articles。默认规则：
      * 未传 output_jsonl -> True
      * 传了 output_jsonl -> False（避免大结果在 tool 消息中被截断）
    """
    uid = params.get("uid", "134209751")

    task_ids = params.get("task_ids", [])
    start_time = params.get("start_time")
    end_time = params.get("end_time")
    keywords = params.get("keywords", "")
    size = int(params.get("size", 20))
    sentiment_filter = params.get("sentiment_filter")
    channel_filter = params.get("channel_filter")
    # 正文截断上限：默认 1500（图表归因场景不变）；标注取数流程可传 2000，传 0 表示不截断。
    output_jsonl = str(params.get("output_jsonl") or "").strip()
    include_articles = _to_bool(params.get("include_articles"), default=(not bool(output_jsonl)))

    try:
        content_max_chars = int(params.get("content_max_chars", 1500))
    except (TypeError, ValueError):
        return json.dumps({"error": "content_max_chars 必须是整数。"})
    if content_max_chars < 0:
        content_max_chars = 0
    
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

        if channel_filter is not None:
            if isinstance(channel_filter, list):
                must_filters.append({"terms": {"dataChannel": [int(c) for c in channel_filter]}})
            else:
                must_filters.append({"term": {"dataChannel": int(channel_filter)}})
            
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
                                    "author",
                                    "prn",
                                    "finger",
                                    "messageContent",
                                    "taskId",
                                    "dataChannel",
                                    "blurb",
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
            
            # 清洗内容，按 content_max_chars 截断以防大模型 Token 撑爆（0 表示不截断）
            raw_content = _resolve_content(source)
            if content_max_chars and len(raw_content) > content_max_chars:
                clean_content = raw_content[:content_max_chars] + "..."
            else:
                clean_content = raw_content
            
            channel_id = source.get("dataChannel")
            results.append({
                "taskId": source.get("taskId"),
                "title": source.get("messageTitle", ""),
                "url": source.get("messageUrl", ""),
                "author": source.get("author", ""),
                "media": source.get("mediaName", ""),
                "time": source.get("messageTime", ""),
                "dataChannel": channel_id,
                "channel_source_name": resolve_channel_name(channel_id),
                "blurb": source.get("blurb", ""),
                "fingerprint_cluster_size": b["doc_count"], # 传播热度
                "content_snippet": clean_content
            })
            
        file_path = ""
        if output_jsonl:
            file_path = _write_jsonl(output_jsonl, results)

        out = {"status": "success", "extracted_count": len(results)}
        if file_path:
            out["file_path"] = file_path
            out["output_jsonl"] = output_jsonl
        if include_articles:
            out["articles"] = results
        return json.dumps(out, ensure_ascii=False, indent=2)
        
    except Exception as e:
        err_msg = traceback.format_exc()
        return json.dumps({"error": f"ES抽样查询失败: {str(e)}", "details": err_msg})


def main():
    if len(sys.argv) > 1:
        try:
            params = json.loads(sys.argv[1])
            print(execute(params))
        except Exception as e:
            print(json.dumps({"error": f"Failed to parse JSON parameters: {str(e)}"}))
    else:
        print(json.dumps({"error": "Missing JSON parameters"}))


if __name__ == "__main__":
    main()
