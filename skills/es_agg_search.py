import json
import urllib.request
import urllib.error
from datetime import datetime
import traceback

ES_URL = "http://139.198.17.239:9203"
# INDEX_NAME will be built dynamically using uid and partition

SENTIMENT_MAP = {
    0: "正面",
    1: "中性",
    -1: "负面"
}

DATA_CHANNEL_MAP = {
    105: "网媒资讯", 106: "论坛", 107: "博客", 108: "微博",
    109: "平媒", 110: "微信", 111: "视频", 112: "资讯APP",
    113: "论坛评论", 114: "长微博", 121: "短视频",
    51: "微博原帖", 95: "搜索引擎", 0: "未知"
}

def execute(params: dict) -> str:
    """
    执行基于 Elasticsearch 的宏观数据统计与聚合。
    
    期望参数 (params):
    - task_ids: list[int] - 要分析的任务 ID 列表 (对应 ES 的 taskId 字段)
    - start_time: str - 开始时间 (YYYY-MM-DD HH:MM:SS)
    - end_time: str - 结束时间 (YYYY-MM-DD HH:MM:SS)
    - dimensions: list[str] - 需统计的维度。支持: "sov", "trend", "channel", "sentiment", "sources", "effect_metrics", "trend_by_channel", "prn_distribution"
    - uid: str/int - 用户 ID
    - partition: str - 索引分区月份 (e.g. "202604")
    """
    uid = params.get("uid", "134209751")
    partition = params.get("partition", "202512")
    index_name = f"{uid}_{partition}"
    
    task_ids = params.get("task_ids", [])
    start_time = params.get("start_time")
    end_time = params.get("end_time")
    dimensions = params.get("dimensions", ["sov"])
    
    if not task_ids or not start_time or not end_time:
        return json.dumps({"error": "缺少必要的参数: task_ids, start_time, end_time"})
        
    try:
        url = f"{ES_URL}/{index_name}/_search"
        
        # 基础过滤条件
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
        
        aggs = {}
        
        # 根据请求维度挂载聚合
        # 1. SOV (按品牌/任务切分声量)
        if "sov" in dimensions:
            aggs["sov_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)}
            }
            
        # 2. 趋势 (按任务分组，内部按天聚合)
        if "trend" in dimensions:
            aggs["trend_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "daily": {
                        "date_histogram": {
                            "field": "messageTime",
                            "calendar_interval": "day",
                            "format": "yyyy-MM-dd"
                        }
                    }
                }
            }
            
        # 3. 渠道分布
        if "channel" in dimensions:
            aggs["channel_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "channels": {
                        "terms": {"field": "dataChannel", "size": 15}
                    }
                }
            }
            
        # 4. 情感分布
        if "sentiment" in dimensions:
            aggs["sentiment_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "sentiments": {
                        "terms": {"field": "sentiment", "size": 5}
                    }
                }
            }
            
        # 5. 删除高耗能的高频词云/热点实体
            
        # 6. KOL 与核心阵地穿透 (按影响力 prn 排序的媒体榜单)
        if "sources" in dimensions:
            aggs["sources_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "top_media": {
                        "terms": {
                            "field": "mediaName",
                            "size": 15,
                            "order": {"total_prn": "desc"}
                        },
                        "aggs": {
                            "total_prn": {"sum": {"field": "prn"}}
                        }
                    }
                }
            }
            
        # 7. 触达效果指标汇总
        if "effect_metrics" in dimensions:
            aggs["effect_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "total_reads": {"sum": {"field": "readnum24h"}},
                    "total_likes": {"sum": {"field": "oriLikes"}}
                }
            }
            
        # 8. 主动发稿 vs 转载 (PRN 占比)
        if "prn_distribution" in dimensions:
            aggs["prn_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "is_prn": {"terms": {"field": "isPRN", "size": 2}}
                }
            }
            
        # 9. 渠道趋势交锋
        if "trend_by_channel" in dimensions:
            aggs["trend_channel_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "daily_trend": {
                        "date_histogram": {
                            "field": "messageTime",
                            "calendar_interval": "day",
                            "format": "MM-dd"
                        },
                        "aggs": {
                            "by_channel": {"terms": {"field": "dataChannel", "size": 5}}
                        }
                    }
                }
            }
            
        payload = {
            "size": 0, # 不需要返回明细数据，只需聚合结果
            "query": {
                "bool": {
                    "filter": must_filters
                }
            },
            "aggs": aggs
        }
        
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
        es_aggs = data.get("aggregations", {})
        total_hits = data.get("hits", {}).get("total", {}).get("value", 0)
        
        # 解析并翻译 ES 聚合结果
        result = {"total_hits": total_hits, "aggs": {}}
        
        if "sov_agg" in es_aggs:
            result["aggs"]["sov"] = [{"task_id": b["key"], "doc_count": b["doc_count"]} for b in es_aggs["sov_agg"].get("buckets", [])]
            
        if "trend_agg" in es_aggs:
            trend_data = {}
            for t_bucket in es_aggs["trend_agg"].get("buckets", []):
                tid = t_bucket["key"]
                trend_data[tid] = [{"date": d["key_as_string"], "doc_count": d["doc_count"]} for d in t_bucket.get("daily", {}).get("buckets", [])]
            result["aggs"]["trend"] = trend_data
            
        if "channel_agg" in es_aggs:
            channel_data = {}
            for t_bucket in es_aggs["channel_agg"].get("buckets", []):
                tid = t_bucket["key"]
                # 翻译渠道 ID
                translated = []
                for c in t_bucket.get("channels", {}).get("buckets", []):
                    c_id = c["key"]
                    c_name = DATA_CHANNEL_MAP.get(c_id, f"未知渠道({c_id})")
                    translated.append({"channel_id": c_id, "channel_name": c_name, "doc_count": c["doc_count"]})
                channel_data[tid] = translated
            result["aggs"]["channel"] = channel_data
            
        if "sentiment_agg" in es_aggs:
            sentiment_data = {}
            for t_bucket in es_aggs["sentiment_agg"].get("buckets", []):
                tid = t_bucket["key"]
                translated = []
                for s in t_bucket.get("sentiments", {}).get("buckets", []):
                    s_id = s["key"]
                    s_name = SENTIMENT_MAP.get(s_id, f"未知情感({s_id})")
                    translated.append({"sentiment_id": s_id, "sentiment_name": s_name, "doc_count": s["doc_count"]})
                sentiment_data[tid] = translated
            result["aggs"]["sentiment"] = sentiment_data

        if "prn_agg" in es_aggs:
            prn_data = {}
            for t_bucket in es_aggs["prn_agg"].get("buckets", []):
                tid = t_bucket["key"]
                items = []
                for b in t_bucket.get("is_prn", {}).get("buckets", []):
                    # b["key_as_string"] is typically "true" or "false"
                    label = "主动发稿" if str(b["key"]).lower() in ["true", "1"] else "自然提及/转载"
                    items.append({"label": label, "doc_count": b["doc_count"]})
                prn_data[tid] = items
            result["aggs"]["prn_distribution"] = prn_data

        if "trend_channel_agg" in es_aggs:
            trend_ch_data = {}
            for t_bucket in es_aggs["trend_channel_agg"].get("buckets", []):
                tid = t_bucket["key"]
                days = []
                for d in t_bucket.get("daily_trend", {}).get("buckets", []):
                    ch_items = [{"channel": c["key"], "doc_count": c["doc_count"]} for c in d.get("by_channel", {}).get("buckets", [])]
                    days.append({"date": d["key_as_string"], "channels": ch_items})
                trend_ch_data[tid] = days
            result["aggs"]["trend_by_channel"] = trend_ch_data
            
        if "sources_agg" in es_aggs:
            source_data = {}
            for t_bucket in es_aggs["sources_agg"].get("buckets", []):
                tid = t_bucket["key"]
                sources = []
                for m in t_bucket.get("top_media", {}).get("buckets", []):
                    # m["total_prn"]["value"] holds the sum
                    prn_val = m.get("total_prn", {}).get("value", 0)
                    sources.append({"media_name": m["key"], "doc_count": m["doc_count"], "total_prn": round(prn_val, 2)})
                source_data[tid] = sources
            result["aggs"]["sources"] = source_data
            
        if "effect_agg" in es_aggs:
            effect_data = {}
            for t_bucket in es_aggs["effect_agg"].get("buckets", []):
                tid = t_bucket["key"]
                effect_data[tid] = {
                    "total_reads_24h": t_bucket.get("total_reads", {}).get("value", 0),
                    "total_likes": t_bucket.get("total_likes", {}).get("value", 0)
                }
            result["aggs"]["effect_metrics"] = effect_data

        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        err_msg = traceback.format_exc()
        return json.dumps({"error": f"ES聚合查询失败: {str(e)}", "details": err_msg})

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
