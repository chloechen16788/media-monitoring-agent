import json
import urllib.request
import urllib.error
from datetime import datetime
import traceback
import sys

ES_URL = "http://139.198.17.239:9203"

SENTIMENT_MAP = {
    0: "正面",
    1: "中性",
    -1: "负面",
}

DATA_CHANNEL_MAP = {
    105: "网媒资讯", 106: "论坛", 107: "博客", 108: "微博",
    109: "平媒", 110: "微信", 111: "视频", 112: "资讯APP",
    113: "论坛评论", 114: "长微博", 121: "短视频",
    51: "微博原帖", 95: "搜索引擎", 0: "未知",
}


def _month_of(time_str) -> str | None:
    try:
        return datetime.strptime(str(time_str).strip()[:10], "%Y-%m-%d").strftime("%Y%m")
    except (ValueError, TypeError):
        return None


def resolve_partition(params: dict):
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


def _nested_algorithm_filter(algorithms: list[int]) -> dict:
    return {
        "nested": {
            "path": "sentimentList",
            "query": {"terms": {"sentimentList.algorithm": algorithms}},
        }
    }


def execute(params: dict) -> str:
    uid = params.get("uid", "134209751")
    task_ids = params.get("task_ids", [])
    start_time = params.get("start_time")
    end_time = params.get("end_time")
    dimensions = params.get("dimensions", ["sov"])
    sentiment_filter = params.get("sentiment_filter")

    if not task_ids or not start_time or not end_time:
        return json.dumps({"error": "缺少必要的参数: task_ids, start_time, end_time"})

    partition, partition_error = resolve_partition(params)
    if partition_error:
        return partition_error

    index_name = f"{uid}_{partition}"
    try:
        must_filters = [
            {"terms": {"taskId": task_ids}},
            {"term": {"isDeleted": False}},
            {"range": {"messageTime": {"gte": start_time, "lte": end_time}}},
        ]
        if sentiment_filter is not None:
            if not isinstance(sentiment_filter, list) or len(sentiment_filter) == 0:
                return json.dumps({"error": "sentiment_filter 必须是非空数组，例如 [-1] 或 [0, 1]"})
            if not all(isinstance(s, (int, float)) for s in sentiment_filter):
                return json.dumps({"error": "sentiment_filter 仅支持数字元素（-1/0/1）"})
            must_filters.append({"terms": {"sentiment": [int(s) for s in sentiment_filter]}})

        aggs = {}
        if "sov" in dimensions:
            aggs["sov_agg"] = {"terms": {"field": "taskId", "size": len(task_ids)}}
        if "trend" in dimensions:
            aggs["trend_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "daily": {
                        "date_histogram": {
                            "field": "messageTime",
                            "calendar_interval": "day",
                            "format": "yyyy-MM-dd",
                        }
                    }
                },
            }
        if "channel" in dimensions:
            aggs["channel_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"channels": {"terms": {"field": "dataChannel", "size": 15}}},
            }
        if "sentiment" in dimensions:
            aggs["sentiment_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"sentiments": {"terms": {"field": "sentiment", "size": 5}}},
            }
        if "sources" in dimensions:
            aggs["sources_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "top_media": {
                        "terms": {"field": "mediaName", "size": 15, "order": {"total_prn": "desc"}},
                        "aggs": {"total_prn": {"sum": {"field": "prn"}}},
                    }
                },
            }
        if "effect_metrics" in dimensions:
            aggs["effect_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "total_reads": {"sum": {"field": "readnum24h"}},
                    "total_likes": {"sum": {"field": "oriLikes"}},
                },
            }
        if "prn_distribution" in dimensions:
            aggs["prn_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"is_prn": {"terms": {"field": "isPRN", "size": 2}}},
            }
        if "trend_by_channel" in dimensions:
            aggs["trend_channel_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "daily_trend": {
                        "date_histogram": {
                            "field": "messageTime",
                            "calendar_interval": "day",
                            "format": "yyyy-MM-dd",
                        },
                        "aggs": {"by_channel": {"terms": {"field": "dataChannel", "size": 5}}},
                    }
                },
            }
        if "trend_by_sentiment" in dimensions:
            aggs["trend_sentiment_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "daily_trend": {
                        "date_histogram": {
                            "field": "messageTime",
                            "calendar_interval": "day",
                            "format": "yyyy-MM-dd",
                        },
                        "aggs": {"by_sentiment": {"terms": {"field": "sentiment", "size": 3}}},
                    }
                },
            }
        if "named_entities" in dimensions:
            aggs["entity_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "ai_scope": {
                        "filter": _nested_algorithm_filter([8]),
                        "aggs": {
                            "entities_nested": {
                                "nested": {"path": "namedEntityList"},
                                "aggs": {
                                    "unique_entity_count": {"cardinality": {"field": "namedEntityList.entityName"}},
                                    "top_entities": {"terms": {"field": "namedEntityList.entityName", "size": 20}},
                                    "entity_type_distribution": {"terms": {"field": "namedEntityList.entityType", "size": 10}},
                                },
                            }
                        },
                    }
                },
            }
        if "keyword_freq" in dimensions:
            aggs["keyword_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "keywords_nested": {
                        "nested": {"path": "messageContentNLPFreq"},
                        "aggs": {
                            "unique_keyword_count": {"cardinality": {"field": "messageContentNLPFreq.word"}},
                            "total_keyword_occurrences": {"sum": {"field": "messageContentNLPFreq.count"}},
                            "top_keywords": {
                                "terms": {
                                    "field": "messageContentNLPFreq.word",
                                    "size": 50,
                                    "order": {"total_count": "desc"},
                                },
                                "aggs": {"total_count": {"sum": {"field": "messageContentNLPFreq.count"}}},
                            },
                        },
                    }
                },
            }
        if "category" in dimensions:
            aggs["category_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"ai_scope": {"filter": _nested_algorithm_filter([7]), "aggs": {"categories": {"terms": {"field": "catId", "size": 30}}}}},
            }
        if "sub_category" in dimensions:
            aggs["sub_category_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"ai_scope": {"filter": _nested_algorithm_filter([7]), "aggs": {"sub_categories": {"terms": {"field": "subCatId", "size": 50}}}}},
            }
        if "tag" in dimensions:
            aggs["tag_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {"ai_scope": {"filter": _nested_algorithm_filter([9]), "aggs": {"tags": {"terms": {"field": "tagIdList", "size": 50}}}}},
            }
        if "trend_by_category" in dimensions:
            aggs["trend_category_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "ai_scope": {
                        "filter": _nested_algorithm_filter([7]),
                        "aggs": {
                            "daily_trend": {
                                "date_histogram": {"field": "messageTime", "calendar_interval": "day", "format": "yyyy-MM-dd"},
                                "aggs": {"by_category": {"terms": {"field": "catId", "size": 10}}},
                            }
                        },
                    }
                },
            }
        if "trend_by_tag" in dimensions:
            aggs["trend_tag_agg"] = {
                "terms": {"field": "taskId", "size": len(task_ids)},
                "aggs": {
                    "ai_scope": {
                        "filter": _nested_algorithm_filter([9]),
                        "aggs": {
                            "daily_trend": {
                                "date_histogram": {"field": "messageTime", "calendar_interval": "day", "format": "yyyy-MM-dd"},
                                "aggs": {"by_tag": {"terms": {"field": "tagIdList", "size": 15}}},
                            }
                        },
                    }
                },
            }

        payload = {"size": 0, "query": {"bool": {"filter": must_filters}}, "aggs": aggs}
        req = urllib.request.Request(
            f"{ES_URL}/{index_name}/_search",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        es_aggs = data.get("aggregations", {})
        result = {"total_hits": data.get("hits", {}).get("total", {}).get("value", 0), "aggs": {}}

        if "sov_agg" in es_aggs:
            result["aggs"]["sov"] = [{"task_id": b["key"], "doc_count": b["doc_count"]} for b in es_aggs["sov_agg"].get("buckets", [])]
        if "trend_agg" in es_aggs:
            result["aggs"]["trend"] = {
                t["key"]: [{"date": d["key_as_string"], "doc_count": d["doc_count"]} for d in t.get("daily", {}).get("buckets", [])]
                for t in es_aggs["trend_agg"].get("buckets", [])
            }
        if "channel_agg" in es_aggs:
            channel_data = {}
            for t in es_aggs["channel_agg"].get("buckets", []):
                channel_data[t["key"]] = [
                    {"channel_id": c["key"], "channel_name": DATA_CHANNEL_MAP.get(c["key"], f"未知渠道({c['key']})"), "doc_count": c["doc_count"]}
                    for c in t.get("channels", {}).get("buckets", [])
                ]
            result["aggs"]["channel"] = channel_data
        if "sentiment_agg" in es_aggs:
            sent_data = {}
            for t in es_aggs["sentiment_agg"].get("buckets", []):
                sent_data[t["key"]] = [
                    {"sentiment_id": s["key"], "sentiment_name": SENTIMENT_MAP.get(s["key"], f"未知情感({s['key']})"), "doc_count": s["doc_count"]}
                    for s in t.get("sentiments", {}).get("buckets", [])
                ]
            result["aggs"]["sentiment"] = sent_data
        if "prn_agg" in es_aggs:
            prn_data = {}
            for t in es_aggs["prn_agg"].get("buckets", []):
                prn_data[t["key"]] = [
                    {"label": "主动发稿" if str(b["key"]).lower() in ["true", "1"] else "自然提及/转载", "doc_count": b["doc_count"]}
                    for b in t.get("is_prn", {}).get("buckets", [])
                ]
            result["aggs"]["prn_distribution"] = prn_data
        if "trend_channel_agg" in es_aggs:
            trend_data = {}
            for t in es_aggs["trend_channel_agg"].get("buckets", []):
                days = []
                for d in t.get("daily_trend", {}).get("buckets", []):
                    days.append({
                        "date": d["key_as_string"],
                        "channels": [
                            {"channel_id": c["key"], "channel_name": DATA_CHANNEL_MAP.get(c["key"], f"未知渠道({c['key']})"), "doc_count": c["doc_count"]}
                            for c in d.get("by_channel", {}).get("buckets", [])
                        ],
                    })
                trend_data[t["key"]] = days
            result["aggs"]["trend_by_channel"] = trend_data
        if "trend_sentiment_agg" in es_aggs:
            trend_data = {}
            for t in es_aggs["trend_sentiment_agg"].get("buckets", []):
                days = []
                for d in t.get("daily_trend", {}).get("buckets", []):
                    days.append({
                        "date": d["key_as_string"],
                        "sentiments": [
                            {"sentiment_id": s["key"], "sentiment_name": SENTIMENT_MAP.get(s["key"], f"未知情感({s['key']})"), "doc_count": s["doc_count"]}
                            for s in d.get("by_sentiment", {}).get("buckets", [])
                        ],
                    })
                trend_data[t["key"]] = days
            result["aggs"]["trend_by_sentiment"] = trend_data
        if "entity_agg" in es_aggs:
            data_map = {}
            for t in es_aggs["entity_agg"].get("buckets", []):
                ai_scope = t.get("ai_scope", {})
                en = ai_scope.get("entities_nested", {})
                data_map[t["key"]] = {
                    "ai_doc_count": ai_scope.get("doc_count", 0),
                    "total_entities": en.get("doc_count", 0),
                    "unique_entity_count": en.get("unique_entity_count", {}).get("value", 0),
                    "top_entities": [{"entity_name": e["key"], "doc_count": e["doc_count"]} for e in en.get("top_entities", {}).get("buckets", [])],
                    "entity_type_distribution": [{"entity_type": e["key"], "doc_count": e["doc_count"]} for e in en.get("entity_type_distribution", {}).get("buckets", [])],
                }
            result["aggs"]["named_entities"] = data_map
        if "keyword_agg" in es_aggs:
            data_map = {}
            for t in es_aggs["keyword_agg"].get("buckets", []):
                kn = t.get("keywords_nested", {})
                data_map[t["key"]] = {
                    "total_keyword_occurrences": round(kn.get("total_keyword_occurrences", {}).get("value", 0), 2),
                    "unique_keyword_count": kn.get("unique_keyword_count", {}).get("value", 0),
                    "top_keywords": [
                        {"word": w["key"], "total_count": round(w.get("total_count", {}).get("value", 0), 2), "doc_count": w["doc_count"]}
                        for w in kn.get("top_keywords", {}).get("buckets", [])
                    ],
                }
            result["aggs"]["keyword_freq"] = data_map
        if "category_agg" in es_aggs:
            result["aggs"]["category"] = {
                t["key"]: {
                    "ai_doc_count": t.get("ai_scope", {}).get("doc_count", 0),
                    "items": [{"cat_id": c["key"], "doc_count": c["doc_count"]} for c in t.get("ai_scope", {}).get("categories", {}).get("buckets", [])],
                }
                for t in es_aggs["category_agg"].get("buckets", [])
            }
        if "sub_category_agg" in es_aggs:
            result["aggs"]["sub_category"] = {
                t["key"]: {
                    "ai_doc_count": t.get("ai_scope", {}).get("doc_count", 0),
                    "items": [{"sub_cat_id": c["key"], "doc_count": c["doc_count"]} for c in t.get("ai_scope", {}).get("sub_categories", {}).get("buckets", [])],
                }
                for t in es_aggs["sub_category_agg"].get("buckets", [])
            }
        if "tag_agg" in es_aggs:
            result["aggs"]["tag"] = {
                t["key"]: {
                    "ai_doc_count": t.get("ai_scope", {}).get("doc_count", 0),
                    "items": [{"tag_id": c["key"], "doc_count": c["doc_count"]} for c in t.get("ai_scope", {}).get("tags", {}).get("buckets", [])],
                }
                for t in es_aggs["tag_agg"].get("buckets", [])
            }
        if "trend_category_agg" in es_aggs:
            result["aggs"]["trend_by_category"] = {
                t["key"]: [
                    {"date": d["key_as_string"], "categories": [{"cat_id": c["key"], "doc_count": c["doc_count"]} for c in d.get("by_category", {}).get("buckets", [])]}
                    for d in t.get("ai_scope", {}).get("daily_trend", {}).get("buckets", [])
                ]
                for t in es_aggs["trend_category_agg"].get("buckets", [])
            }
        if "trend_tag_agg" in es_aggs:
            result["aggs"]["trend_by_tag"] = {
                t["key"]: [
                    {"date": d["key_as_string"], "tags": [{"tag_id": c["key"], "doc_count": c["doc_count"]} for c in d.get("by_tag", {}).get("buckets", [])]}
                    for d in t.get("ai_scope", {}).get("daily_trend", {}).get("buckets", [])
                ]
                for t in es_aggs["trend_tag_agg"].get("buckets", [])
            }
        if "sources_agg" in es_aggs:
            source_data = {}
            for t in es_aggs["sources_agg"].get("buckets", []):
                source_data[t["key"]] = [
                    {"media_name": m["key"], "doc_count": m["doc_count"], "total_prn": round(m.get("total_prn", {}).get("value", 0), 2)}
                    for m in t.get("top_media", {}).get("buckets", [])
                ]
            result["aggs"]["sources"] = source_data
        if "effect_agg" in es_aggs:
            result["aggs"]["effect_metrics"] = {
                t["key"]: {
                    "total_reads_24h": t.get("total_reads", {}).get("value", 0),
                    "total_likes": t.get("total_likes", {}).get("value", 0),
                }
                for t in es_aggs["effect_agg"].get("buckets", [])
            }
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": f"ES聚合查询失败: {str(e)}", "details": traceback.format_exc()})


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
