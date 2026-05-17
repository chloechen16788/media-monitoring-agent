import sys
import json
import urllib.request
import urllib.error

FIRE_CRAWL_KEY = "fc-aa4827ddb18e4bc3a7b4415318c28dfd"
FIRE_CRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search"

def search_firecrawl(query: str, limit: int = 5) -> str:
    headers = {
        'Authorization': f'Bearer {FIRE_CRAWL_KEY}',
        'Content-Type': 'application/json'
    }
    
    payload = {
        "query": query,
        "limit": limit
    }
    
    data = json.dumps(payload).encode('utf-8')
    
    try:
        req = urllib.request.Request(FIRE_CRAWL_SEARCH_URL, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=15) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
            if res_data.get('success'):
                results = res_data.get('data', [])
                if not results:
                    return "未找到相关搜索结果。"
                    
                output = f"Web Search Results for '{query}':\n\n"
                for i, res in enumerate(results, 1):
                    title = res.get('title', 'No Title')
                    desc = res.get('description', 'No Description')
                    url = res.get('url', 'No URL')
                    output += f"[{i}] {title}\n    {desc}\n    URL: {url}\n\n"
                return output
            else:
                return f"搜索失败: {res_data.get('error', 'Unknown error')}"
                
    except urllib.error.HTTPError as e:
        try:
            error_msg = e.read().decode('utf-8')
        except:
            error_msg = ""
        return f"API 请求失败 ({e.code}): {error_msg}"
    except Exception as e:
        return f"搜索异常: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python web_search.py <query>")
        sys.exit(1)
        
    query = " ".join(sys.argv[1:])
    print(search_firecrawl(query))
