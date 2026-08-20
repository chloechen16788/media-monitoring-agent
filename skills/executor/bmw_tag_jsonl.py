"""BMW 硬核科技新闻标注技能（A 类 / role=sub）。

读取一个 JSONL 批次 → 调用标注模型（默认 Gemini 原生 API；备用 gateway；
预留 local 扩展）→ 写回 annotated JSONL（原字段 + 标注字段）。

默认 provider=gemini 走 Google 原生 generateContent 接口（QPS 高）；
provider=gateway 备用走 OpenAI 兼容网关；provider=local 预留扩展。
模型隔离硬规则：标注模型仅通过本 skill 调用，仅读取 SKILL_TAGGING_* 配置；
严禁用于对话/规划/其他推理（对话仍用 WORKER_MODEL = minimax）。

入参: argv[1] 单个 JSON 字符串（见 docs/bmw_tag_jsonl.md）
出参: stdout 单个 JSON 对象 {"ok": ..., "data"|"error": ...}
进度: 周期性原子写 progress_file（不打 stdout，遵守输出契约）。
"""

import json
import os
import random
import re
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime


BMW_PROMPT_TEMPLATE = """你是一个专业的新闻数据标注专家。请对【标题】与【输入文本】进行深度语义分析，判定其是否为“高价值硬核科技新闻”（默认输入文本为摘要，必要时可切换为正文）。

1. 技术领域：属于 汽车产业链科技发布（自动驾驶/传感器/激光雷达/汽车芯片/电池电驱/热管理/一体压铸/智能制造/驾驶监测/座舱/HUD/轻量化材料等，详见说明)、AI大模型/芯片、前沿硬科技(机器人/脑机/新材料/核聚变)。注意：汽车>前沿科技>AI
2. 地域要求：必须是【国内】主体（中港澳台企业）主导，或国内团队主导的研发。排除外企在中国研发、排除合资品牌（如别克、奥迪、大众）。
3. 性质要求：必须是【正向】的【具体技术突破】或【基于新技术的新品首发】。
4. 严格排除项（只要命中任一则标为“否”）：
   - 纯应用/商业落地：如“机器人进电影院卖爆米花”、“巡检机器人中标”。
   - 营销/常规更新：直播、新车上市（重点是价格）、改款车型、新配色、内饰升级、配置堆砌（如增加了冰箱/大灯/气囊）、销量/交付/市占率数据。
   - 非技术核心：融资信息（重点在钱）、IPO信息、中标/招标、获奖/荣誉、人事变动、战略规划、行业标准/政策、法律责任讨论（伦理）。
   - 汇总类：日报、周报、多个不相关新闻的合集。

【说明】
汽车产业链包括以下领域
三电和能源
    * 三电系统：动力电池、电机、电控、电驱系统。
    * 补能与储能： 充电桩、换电、储能。
    * 热管理： 汽车热管理系统。

* 智能化相关
    * 半导体/芯片：芯片（智驾芯片、座舱芯片、MCU）、功率半导体。
    * 感知与通讯：传感器（激光雷达、毫米波雷达、摄像头）、通讯技术。
    * 电气架构： 域控制器。
    * 智能座舱、消费电子、汽车相关的声学和视觉。

* 先进制造
    * 智能工厂、一体化压铸、工业机器人。
    * 工厂数字孪生、供应链管理、CAD/CAE。

* 新材料&可持续
    * 轻量化材料、新型环保材料
    * 电池回收

【判别思维链】
- 第一步：主体是谁？是否国内主导？（否 -> 结束，标“否”）
- 第二步：是否属于关注的技术领域？（否 -> 结束，标“否”）
- 第三步：重点是新技术突破本身，还是商业落地/公关获奖/常规配置堆砌？（非技术本身 -> 标“否”）

【待处理数据】
标题：{title}
{text_label}：{text}

【输出格式】请直接输出 JSON：
{{
    "is_important_tech_news": "是/否",
    "reason": "简要说明（如：主体为国内，属于AI领域，但属于中标/商业应用新闻，故排除）",
    "tech_category": "分类标签",
    "location": "国内/国外",
    "subject": "主体名称"
}}
"""

BMW_BATCH_PROMPT_TEMPLATE = """你是一个专业的新闻数据标注专家。请对下面多条新闻的【标题+摘要】做批量判定。

【判定核心：必须同时满足以下 4 点才标为“是”】
1. 技术领域：属于 汽车产业链科技发布（自动驾驶/智驾系统/传感器/激光雷达/汽车芯片/电池电驱/热管理/一体压铸/智能制造/驾驶监测/座舱/HUD/轻量化材料)、AI大模型/芯片、前沿硬科技(机器人/脑机/新材料/核聚变)。注意：汽车>前沿科技>AI
2. 地域要求：必须是【国内】主体（中港澳台企业）主导，或国内团队主导的研发。排除外企在中国研发、排除合资品牌（如别克、奥迪、大众）。
3. 性质要求：必须是【正向】的【具体技术突破】或【基于新技术的新品首发】。
4. 严格排除项（只要命中任一则标为“否”）：
   - 纯应用/商业落地：如“机器人进电影院卖爆米花”、“巡检机器人中标”。
   - 营销/常规更新：直播、新车上市（重点是价格）、改款车型、新配色、内饰升级、配置堆砌（如增加了冰箱/大灯/气囊）、销量/交付/市占率数据。
   - 非技术核心：融资信息（重点在钱）、IPO信息、中标/招标、获奖/荣誉、人事变动、战略规划、行业标准/政策、法律责任讨论（伦理）。
   - 汇总类：日报、周报、多个不相关新闻的合集。
   - 标题：标题中带有起售、金额等价格关键字，以及过于夸张的表述，不属于新闻的类型。

【待处理数据（JSON数组）】
{items_json}

【输出格式】
只输出一个 JSON 数组，每个元素对应输入一条，必须包含字段：
[
  {{
    "idx": 0,
    "is_important_tech_news": "是/否",
    "reason": "简要说明",
    "tech_category": "分类标签",
    "location": "国内/国外",
    "subject": "主体名称"
  }}
]
硬性约束（必须满足）：
1) 输出数组长度必须等于 {expected_count}。
2) 输出 idx 集合必须与输入 idx 完全一致（无缺失、无重复、无新增）。
3) 严禁输出数组外文本。
输入 idx 清单：{expected_indices_json}
不得输出数组外其他文本。
"""

LABEL_KEYS = ["is_important_tech_news", "reason", "tech_category", "location", "subject"]
BLURB_BATCH_SIZE = 30
BLURB_MAX_WORKERS_DEFAULT = 2
CONTENT_MAX_WORKERS_DEFAULT = 23
DEFAULT_REQUEST_TIMEOUT_SEC = 120
DEFAULT_FLUSH_EVERY = 100
# Excel / openpyxl 非法字符（保留 \t \n \r）
ILLEGAL_EXCEL_CHAR_RE = re.compile(r"[\x00-\x08\x0B-\x0C\x0E-\x1F]")


def fail(error: str, hint: str = "") -> None:
    payload = {"ok": False, "error": error}
    if hint:
        payload["hint"] = hint
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def read_params() -> dict:
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        fail("参数必须是单个合法的 JSON 字符串（禁止单引号）。")
    if not isinstance(parsed, dict):
        fail("参数 JSON 必须是对象。")
    return parsed


def atomic_write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_jsonl(path: str) -> list:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def row_identity(row: dict, fallback_idx: int) -> str:
    """稳定识别一行，便于重跑时复用已写出的部分标注。"""
    for key in ("_row", "row_id", "__row_id", "url", "messageUrl", "finger"):
        value = row.get(key)
        if value not in (None, ""):
            return f"{key}:{value}"
    title = str(row.get("title") or row.get("messageTitle") or "")
    ts = str(row.get("time") or row.get("messageTime") or "")
    if title or ts:
        return f"title_time:{title}|{ts}"
    return f"idx:{fallback_idx}"


def load_existing_labels(output_jsonl: str, rows: list[dict]) -> dict[int, dict]:
    if not output_jsonl or not os.path.exists(output_jsonl):
        return {}

    row_key_to_idx = {row_identity(row, idx): idx for idx, row in enumerate(rows)}
    labels = {}
    for out_row in read_jsonl(output_jsonl):
        if not isinstance(out_row, dict):
            continue
        key = row_identity(out_row, -1)
        idx = row_key_to_idx.get(key)
        if idx is None:
            continue
        label = {k: out_row.get(k, "") for k in LABEL_KEYS}
        if any(label.values()):
            labels[idx] = label
    return labels


def sanitize_excel_illegal_chars(value):
    """递归清洗字符串中的 Excel 非法控制字符，替换为空格。"""
    if isinstance(value, str):
        return ILLEGAL_EXCEL_CHAR_RE.sub(" ", value)
    if isinstance(value, list):
        return [sanitize_excel_illegal_chars(v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize_excel_illegal_chars(v) for k, v in value.items()}
    return value


def _build_opener(proxy_url: str):
    if proxy_url:
        handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        return urllib.request.build_opener(handler)
    return urllib.request.build_opener()


def call_gemini_native(
    base_url: str,
    model: str,
    prompt: str,
    api_key: str,
    proxy_url: str,
    timeout_sec: int,
) -> str:
    """Google 原生 generateContent 接口（QPS 高）。

    URL: {base_url}/v1beta/models/{model}:generateContent?key={api_key}
    请求体: {"contents":[{"parts":[{"text":...}]}]}
    响应:   candidates[0].content.parts[0].text
    """
    url = f"{base_url.rstrip('/')}/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0},
    }
    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    opener = _build_opener(proxy_url)
    with opener.open(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    data = json.loads(body)
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def call_openai_compatible(
    base_url: str,
    model: str,
    prompt: str,
    env_tag: str,
    api_key: str,
    timeout_sec: int,
) -> str:
    """OpenAI 兼容 /v1/chat/completions（走公司网关，QPS 较低，备用）。"""
    url = base_url.rstrip("/") + "/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": f"CMM-Tool-{env_tag}",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    data = json.loads(body)
    return data["choices"][0]["message"]["content"].strip()


def build_caller(provider: str):
    """返回 (caller, error)；caller(prompt)->text。模型配置全部走环境变量。"""
    try:
        timeout_sec = int(os.environ.get("SKILL_TAGGING_TIMEOUT_SEC", DEFAULT_REQUEST_TIMEOUT_SEC))
    except (TypeError, ValueError):
        timeout_sec = DEFAULT_REQUEST_TIMEOUT_SEC
    timeout_sec = max(30, min(timeout_sec, 300))

    if provider == "gemini":
        # Google 原生接口（默认，QPS 高）
        api_key = os.environ.get("SKILL_TAGGING_API_KEY")
        if not api_key:
            return None, "missing env: SKILL_TAGGING_API_KEY"
        base = os.environ.get("SKILL_TAGGING_BASE_URL", "https://generativelanguage.googleapis.com")
        model = os.environ.get("SKILL_TAGGING_MODEL", "gemini-2.0-flash")
        proxy_url = os.environ.get("SKILL_TAGGING_PROXY", "")
        return (lambda prompt: call_gemini_native(base, model, prompt, api_key, proxy_url, timeout_sec)), None
    if provider == "gateway":
        # OpenAI 兼容网关（备用，QPS 较低）
        base = os.environ.get("SKILL_TAGGING_GATEWAY_URL")
        model = os.environ.get("SKILL_TAGGING_GATEWAY_MODEL")
        if not base or not model:
            return None, "missing env: SKILL_TAGGING_GATEWAY_URL / SKILL_TAGGING_GATEWAY_MODEL"
        env_tag = os.environ.get("SKILL_TAGGING_ENV", "qa")
        api_key = os.environ.get("SKILL_TAGGING_GATEWAY_API_KEY", "")
        return (lambda prompt: call_openai_compatible(base, model, prompt, env_tag, api_key, timeout_sec)), None
    if provider == "local":
        return None, "local provider 尚未接入（预留扩展位）。"
    return None, f"unsupported provider: {provider}"


def parse_label(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {"is_important_tech_news": "解析失败", "reason": "未找到有效JSON"}
    try:
        obj = json.loads(match.group())
    except json.JSONDecodeError:
        return {"is_important_tech_news": "解析失败", "reason": "JSON解析异常"}
    return {k: obj.get(k, "") for k in LABEL_KEYS}


def parse_batch_labels(text: str, expected_indices: list[int]) -> dict[int, dict]:
    fallback = {idx: {"is_important_tech_news": "解析失败", "reason": "批量结果缺失"} for idx in expected_indices}

    # 优先解析 markdown code block
    block_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    candidates = []
    if block_match:
        candidates.append(block_match.group(1).strip())
    candidates.append(text.strip())

    parsed = None
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            break
        except json.JSONDecodeError:
            array_match = re.search(r"\[[\s\S]*\]", cand)
            if array_match:
                try:
                    parsed = json.loads(array_match.group())
                    break
                except json.JSONDecodeError:
                    pass

    if not isinstance(parsed, list):
        return fallback

    expected_count = len(expected_indices)
    returned_count = len(parsed)
    missing_reason = f"批量结果缺失(期望{expected_count}条,返回{returned_count}条)"
    out = {
        idx: {"is_important_tech_news": "解析失败", "reason": missing_reason}
        for idx in expected_indices
    }
    for item in parsed:
        if not isinstance(item, dict):
            continue
        idx = item.get("idx")
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            continue
        if idx not in out:
            continue
        out[idx] = {k: item.get(k, "") for k in LABEL_KEYS}
    return out


def tag_one(caller, prompt: str, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            text = caller(prompt)
            return parse_label(text)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                time.sleep((2 ** attempt) + random.random())
                continue
            if attempt == max_retries - 1:
                return {"is_important_tech_news": "错误", "reason": f"API错误: {e.code}"}
        except Exception as e:  # noqa: BLE001
            if attempt == max_retries - 1:
                return {"is_important_tech_news": "异常", "reason": str(e)[:80]}
            time.sleep(1)
    return {"is_important_tech_news": "重试失败", "reason": "超过最大重试次数"}


def tag_batch(caller, prompt: str, expected_indices: list[int], max_retries: int = 3) -> dict[int, dict]:
    for attempt in range(max_retries):
        try:
            text = caller(prompt)
            return parse_batch_labels(text, expected_indices)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                time.sleep((2 ** attempt) + random.random())
                continue
            if attempt == max_retries - 1:
                return {
                    idx: {"is_important_tech_news": "错误", "reason": f"API错误: {e.code}"}
                    for idx in expected_indices
                }
        except Exception as e:  # noqa: BLE001
            if attempt == max_retries - 1:
                return {
                    idx: {"is_important_tech_news": "异常", "reason": str(e)[:80]}
                    for idx in expected_indices
                }
            time.sleep(1)
    return {
        idx: {"is_important_tech_news": "重试失败", "reason": "超过最大重试次数"}
        for idx in expected_indices
    }


def write_progress(
    progress_file: str,
    done: int,
    total: int,
    ok: int,
    fail_cnt: int,
    output_jsonl: str = "",
    partial: bool = False,
) -> None:
    if not progress_file:
        return
    try:
        payload = {
            "done": done, "total": total, "ok": ok, "fail": fail_cnt,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        if output_jsonl:
            payload["output_jsonl"] = os.path.abspath(output_jsonl)
        if partial:
            payload["partial"] = True
        atomic_write(progress_file, json.dumps(payload, ensure_ascii=False))
    except OSError:
        pass


def update_manifest(manifest_path: str, batch_id, output_jsonl: str) -> None:
    if not manifest_path or batch_id is None or not os.path.exists(manifest_path):
        return
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        run_dir = os.path.dirname(os.path.abspath(manifest_path))
        try:
            annotated_rel = os.path.relpath(os.path.abspath(output_jsonl), run_dir)
        except ValueError:
            annotated_rel = output_jsonl
        for b in manifest.get("batches", []):
            if b.get("id") == batch_id:
                b["annotated"] = annotated_rel
                b["status"] = "annotated"
                break
        atomic_write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2))
    except (OSError, json.JSONDecodeError):
        pass


def resolve_from_manifest(manifest_path: str, batch_id, input_jsonl: str, output_jsonl: str):
    """根据 manifest 自动定位下一批（status=exported）及其路径。"""
    if not manifest_path:
        return input_jsonl, output_jsonl, batch_id, None
    if not os.path.exists(manifest_path):
        fail(f"manifest_path 不存在: {manifest_path}")

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, json.JSONDecodeError):
        fail(f"manifest_path 不是合法 JSON: {manifest_path}")

    batches = manifest.get("batches", [])
    if not isinstance(batches, list) or not batches:
        fail("manifest 中缺少有效 batches。")

    selected = None
    if batch_id is not None:
        for b in batches:
            if b.get("id") == batch_id:
                selected = b
                break
        if selected is None:
            fail(f"manifest 中不存在 batch_id={batch_id}。")
    else:
        for b in batches:
            if str(b.get("status", "")).lower() == "exported":
                selected = b
                batch_id = b.get("id")
                break
        if selected is None:
            fail("manifest 中没有 status=exported 的批次。", "全部批次可能已标注完成。")

    run_dir = os.path.dirname(os.path.abspath(manifest_path))
    raw_rel = str(selected.get("raw") or "")
    if not input_jsonl:
        if not raw_rel:
            fail("manifest 批次缺少 raw 路径，无法推导 input_jsonl。")
        input_jsonl = os.path.join(run_dir, raw_rel)

    if not output_jsonl:
        annotated_rel = str(selected.get("annotated") or "")
        if not annotated_rel:
            bid = int(selected.get("id") if selected.get("id") is not None else batch_id)
            annotated_rel = f"annotated/batch_{bid:03d}.jsonl"
        output_jsonl = os.path.join(run_dir, annotated_rel)

    return input_jsonl, output_jsonl, batch_id, selected


def main() -> None:
    params = read_params()

    input_jsonl = str(params.get("input_jsonl") or "")
    output_jsonl = str(params.get("output_jsonl") or "")
    manifest_path = str(params.get("manifest_path") or "")
    batch_id = params.get("batch_id")
    input_jsonl, output_jsonl, batch_id, _ = resolve_from_manifest(
        manifest_path=manifest_path,
        batch_id=batch_id,
        input_jsonl=input_jsonl,
        output_jsonl=output_jsonl,
    )
    if not input_jsonl or not output_jsonl:
        fail("缺少必要参数: input_jsonl, output_jsonl。", "可传 manifest_path 自动推导下一批路径。")
    if not os.path.exists(input_jsonl):
        fail(f"input_jsonl 不存在: {input_jsonl}", "请先用 es_export_jsonl_batches 生成 JSONL 批次。")

    title_field = str(params.get("title_field") or "title")
    input_text_mode = str(params.get("input_text_mode") or "blurb").lower()
    blurb_field = str(params.get("blurb_field") or "blurb")
    content_field = str(params.get("content_field") or "content_snippet")
    if input_text_mode not in ("blurb", "content"):
        fail('input_text_mode 仅支持 "blurb" 或 "content"。')
    try:
        content_max_chars = int(params.get("content_max_chars", 2000))
    except (TypeError, ValueError):
        fail("content_max_chars 必须是整数。")
    content_max_chars = max(0, content_max_chars)

    provider = str(params.get("provider") or "gemini").lower()
    default_workers = BLURB_MAX_WORKERS_DEFAULT if input_text_mode == "blurb" else CONTENT_MAX_WORKERS_DEFAULT
    try:
        max_workers = int(params.get("max_workers") or default_workers)
    except (TypeError, ValueError):
        fail("max_workers 必须是整数。")
    max_workers = max(1, min(max_workers, 64))

    try:
        max_records = int(params.get("max_records") or 1500)
    except (TypeError, ValueError):
        fail("max_records 必须是整数。")

    try:
        flush_every = int(params.get("flush_every") or DEFAULT_FLUSH_EVERY)
    except (TypeError, ValueError):
        fail("flush_every 必须是整数。")
    flush_every = max(1, flush_every)

    progress_file = str(params.get("progress_file") or "")
    prompt_template = str(params.get("prompt_override") or BMW_PROMPT_TEMPLATE)
    batch_prompt_template = str(params.get("batch_prompt_override") or BMW_BATCH_PROMPT_TEMPLATE)

    rows = read_jsonl(input_jsonl)
    if not rows:
        fail(f"input_jsonl 为空或无有效行: {input_jsonl}")
    if len(rows) > max_records:
        fail(
            f"本批 {len(rows)} 条超过 max_records={max_records}。",
            "请减小 batch_size 或调高 max_records 后重试（成本围栏）。",
        )

    caller, caller_err = build_caller(provider)
    if caller_err:
        fail(caller_err, "请检查标注模型环境变量配置；标注模型仅用于标注，不用于对话。")

    total = len(rows)
    results_map = load_existing_labels(output_jsonl, rows)
    existing_done = len(results_map)

    def is_success_label(label: dict) -> bool:
        return str(label.get("is_important_tech_news")) in ("是", "否")

    done = len(results_map)
    ok_cnt = sum(1 for label in results_map.values() if is_success_label(label))
    fail_cnt = done - ok_cnt
    write_progress(
        progress_file,
        done,
        total,
        ok_cnt,
        fail_cnt,
        output_jsonl=output_jsonl,
        partial=done < total,
    )

    last_flushed_done = done

    def build_output_lines():
        label_dist = {}
        out_lines = []
        for i, row in enumerate(rows):
            if i not in results_map:
                continue
            label = results_map[i]
            merged = dict(row)
            merged.update(label)
            cleaned = sanitize_excel_illegal_chars(merged)
            out_lines.append(json.dumps(cleaned, ensure_ascii=False))
            key = str(label.get("is_important_tech_news", "缺失"))
            label_dist[key] = label_dist.get(key, 0) + 1
        return out_lines, label_dist

    def flush_output(force: bool = False):
        nonlocal last_flushed_done
        if not force and done - last_flushed_done < flush_every:
            return
        out_lines, _ = build_output_lines()
        atomic_write(output_jsonl, "\n".join(out_lines) + ("\n" if out_lines else ""))
        last_flushed_done = done

    def task(idx_row):
        idx, row = idx_row
        title = str(row.get(title_field, ""))
        if input_text_mode == "content":
            text = str(row.get(content_field, ""))
            if content_max_chars and len(text) > content_max_chars:
                text = text[:content_max_chars]
            text_label = "正文"
        else:
            text = str(row.get(blurb_field, ""))
            text_label = "摘要"
        prompt = prompt_template.format(
            title=title,
            text=text,
            text_label=text_label,
            # 兼容历史 prompt_override 占位符
            content=text,
            blurb=text if input_text_mode == "blurb" else str(row.get(blurb_field, "")),
        )
        return idx, tag_one(caller, prompt)

    if input_text_mode == "blurb":
        chunks = []
        for start in range(0, total, BLURB_BATCH_SIZE):
            end = min(start + BLURB_BATCH_SIZE, total)
            chunk_items = []
            chunk_indices = []
            for idx in range(start, end):
                if idx in results_map:
                    continue
                row = rows[idx]
                chunk_indices.append(idx)
                chunk_items.append({
                    "idx": idx,
                    "title": str(row.get(title_field, "")),
                    "blurb": str(row.get(blurb_field, "")),
                })
            if chunk_indices:
                chunks.append((chunk_indices, chunk_items))

        def batch_task(chunk):
            idx_list, item_list = chunk
            prompt = batch_prompt_template.format(
                items_json=json.dumps(item_list, ensure_ascii=False),
                expected_count=len(idx_list),
                expected_indices_json=json.dumps(idx_list, ensure_ascii=False),
            )
            return tag_batch(caller, prompt, idx_list)

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [ex.submit(batch_task, c) for c in chunks]
            for fut in as_completed(futures):
                label_map = fut.result()
                for idx, label in label_map.items():
                    results_map[idx] = label
                    done += 1
                    if is_success_label(label):
                        ok_cnt += 1
                    else:
                        fail_cnt += 1
                if done % 20 == 0 or done == total:
                    write_progress(
                        progress_file,
                        done,
                        total,
                        ok_cnt,
                        fail_cnt,
                        output_jsonl=output_jsonl,
                        partial=done < total,
                    )
                flush_output(force=(done == total))
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = [ex.submit(task, (i, r)) for i, r in enumerate(rows) if i not in results_map]
            for fut in as_completed(futures):
                idx, label = fut.result()
                results_map[idx] = label
                done += 1
                if is_success_label(label):
                    ok_cnt += 1
                else:
                    fail_cnt += 1
                if done % 20 == 0 or done == total:
                    write_progress(
                        progress_file,
                        done,
                        total,
                        ok_cnt,
                        fail_cnt,
                        output_jsonl=output_jsonl,
                        partial=done < total,
                    )
                flush_output(force=(done == total))

    # 顺序回填，原字段全保留，标注字段横向追加
    out_lines, label_dist = build_output_lines()
    atomic_write(output_jsonl, "\n".join(out_lines) + ("\n" if out_lines else ""))
    write_progress(progress_file, done, total, ok_cnt, fail_cnt, output_jsonl=output_jsonl, partial=done < total)
    if done == total:
        update_manifest(manifest_path, batch_id, output_jsonl)

    result = {
        "ok": True,
        "data": {
            "input_jsonl": input_jsonl,
            "output_jsonl": os.path.abspath(output_jsonl),
            "provider": provider,
            "input_text_mode": input_text_mode,
            "total": total,
            "done": done,
            "resumed": existing_done > 0,
            "flush_every": flush_every,
            "succeeded": ok_cnt,
            "failed": fail_cnt,
            "label_distribution": label_dist,
            "partial": done < total,
        },
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
