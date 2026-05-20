import sys
import json
import traceback
import es_agg_search
import es_sample_search

def main():
    try:
        # Read JSON from stdin
        input_data = sys.stdin.read()
        if not input_data.strip():
            print(json.dumps({"error": "No input provided"}))
            return
            
        params = json.loads(input_data)
        
        uid = params.get("uid", "134209751")
        partition = params.get("partition", "202604")
        date_range = params.get("date_range", ["2026-04-01 00:00:00", "2026-04-30 23:59:59"])

        categories = params.get("categories", [])
        entityTasks = params.get("entityTasks", {})
        
        # We will collect all tasks from categories or entityTasks to do a unified query
        all_task_ids = set()
        all_dimensions = set(["sov", "trend", "channel", "sentiment", "sources", "effect_metrics", "trend_by_channel", "prn_distribution"])
        
        # Backward compatibility for old categories format
        for cat in categories:
            for t in cat.get("tasks", []):
                task_id_int = 6860
                if t.get("id") == "t_bmw": task_id_int = 6860
                elif t.get("id") == "t_benz": task_id_int = 6861
                elif t.get("id") == "t_audi": task_id_int = 6862
                all_task_ids.add(task_id_int)
                
        # New entityTasks format
        for entity_key, tasks in entityTasks.items():
            for t in tasks:
                task_id_int = 6860
                if t.get("id") == "t_bmw": task_id_int = 6860
                elif t.get("id") == "t_benz": task_id_int = 6861
                elif t.get("id") == "t_audi": task_id_int = 6862
                all_task_ids.add(task_id_int)

        if not all_task_ids:
            all_task_ids = {6860}
            
        agg_params = {
            "uid": uid,
            "partition": partition,
            "task_ids": list(all_task_ids),
            "start_time": date_range[0],
            "end_time": date_range[1],
            "dimensions": list(all_dimensions)
        }
        
        sample_params = {
            "uid": uid,
            "partition": partition,
            "task_ids": list(all_task_ids),
            "start_time": date_range[0],
            "end_time": date_range[1],
            "size": 20
        }
        
        negative_sample_params = {
            "uid": uid,
            "partition": partition,
            "task_ids": list(all_task_ids),
            "start_time": date_range[0],
            "end_time": date_range[1],
            "size": 10,
            "sentiment_filter": -1
        }
        
        import concurrent.futures
        
        # Run ES Queries in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_agg = executor.submit(es_agg_search.execute, agg_params)
            future_sample = executor.submit(es_sample_search.execute, sample_params)
            future_neg_sample = executor.submit(es_sample_search.execute, negative_sample_params)
            
            agg_result_str = future_agg.result()
            sample_result_str = future_sample.result()
            neg_sample_str = future_neg_sample.result()
            
        agg_result = json.loads(agg_result_str)
        sample_result = json.loads(sample_result_str)
        neg_sample = json.loads(neg_sample_str)
        
        final_output = {
            "status": "success",
            "agg_data": agg_result,
            "sample_data": sample_result,
            "negative_sample_data": neg_sample
        }
        
        # Print JSON output to stdout
        print(json.dumps(final_output, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))

if __name__ == "__main__":
    main()
