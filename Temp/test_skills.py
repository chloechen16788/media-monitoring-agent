from skills import es_agg_search, es_sample_search
import json

print("Testing es_agg_search...")
agg_params = {
    "task_ids": [101, 102],
    "start_time": "2025-12-01 00:00:00",
    "end_time": "2025-12-31 23:59:59",
    "dimensions": ["sov", "trend", "channel", "sentiment"]
}
res_agg = es_agg_search.execute(agg_params)
print("Agg Result (keys):", json.loads(res_agg).keys())
print("Total Hits:", json.loads(res_agg).get("total_hits"))

print("\nTesting es_sample_search...")
sample_params = {
    "task_ids": [101, 102],
    "start_time": "2025-12-01 00:00:00",
    "end_time": "2025-12-31 23:59:59",
    "size": 2
}
res_sample = es_sample_search.execute(sample_params)
print("Sample Result:", res_sample[:500])

