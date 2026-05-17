import sys
import json
import urllib.request
import urllib.error

FIRE_CRAWL_KEY = "fc-aa4827ddb18e4bc3a7b4415318c28dfd"
FIRE_CRAWL_URL = "https://api.firecrawl.dev/v1/scrape"

def scrape_url(url: str) -> str:
    headers = {
        'Authorization': f'Bearer {FIRE_CRAWL_KEY}',
        'Content-Type': 'application/json'
    }
    
    payload = {
        "url": url,
        "formats": ["markdown"]
    }
    
    data = json.dumps(payload).encode('utf-8')
    
    try:
        req = urllib.request.Request(FIRE_CRAWL_URL, data=data, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=30) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
            if res_data.get('success'):
                markdown = res_data.get('data', {}).get('markdown', '')
                return f"[Deep Crawl Results for {url}]\n\n{markdown}"
            else:
                return f"抓取失败: {res_data.get('error', 'Unknown error')}"
                
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')
        return f"API 请求失败 ({e.code}): {error_msg}"
    except Exception as e:
        return f"抓取异常: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python deep_web_crawl.py <url>")
        sys.exit(1)
        
    url = sys.argv[1]
    print(scrape_url(url))
