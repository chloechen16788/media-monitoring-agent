import urllib.request
import json
import traceback

ES_URL = "http://139.198.17.239:9203"
INDEX_NAME = "134209751_202512"

def test_connection():
    try:
        print(f"Testing connection to {ES_URL}...")
        req = urllib.request.Request(f"{ES_URL}/")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("Successfully connected to ES cluster!")
            print(f"Cluster Name: {data.get('cluster_name')}")
            print(f"Version: {data.get('version', {}).get('number')}")
    except Exception as e:
        print("Failed to connect to cluster root.")
        traceback.print_exc()

def test_search():
    try:
        print(f"\nTesting search on index {INDEX_NAME}...")
        url = f"{ES_URL}/{INDEX_NAME}/_search"
        payload = {
            "size": 1,
            "query": {
                "match_all": {}
            }
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            total_hits = data.get("hits", {}).get("total", {})
            if isinstance(total_hits, dict):
                total_hits = total_hits.get("value")
            print(f"Successfully queried {INDEX_NAME}!")
            print(f"Total Hits: {total_hits}")
            
            hits = data.get("hits", {}).get("hits", [])
            if hits:
                source = hits[0].get("_source", {})
                print("Sample Data Sample Keys:")
                print(list(source.keys()))
                print(f"Sample 'messageTitle': {source.get('messageTitle', 'N/A')}")
            else:
                print("No documents found.")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} {e.reason}")
        print(e.read().decode())
    except Exception as e:
        print("Failed to search index.")
        traceback.print_exc()

if __name__ == "__main__":
    test_connection()
    test_search()
