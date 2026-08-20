import json
import os
import socket
import time
import urllib.error
import urllib.request


DEFAULT_ES_TIMEOUT_SEC = 60
DEFAULT_ES_MAX_RETRIES = 2
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}


class EsRequestError(Exception):
    def __init__(self, message: str, attempts: list[dict], timeout_sec: int):
        super().__init__(message)
        self.attempts = attempts
        self.timeout_sec = timeout_sec


def _int_setting(params: dict, key: str, env_key: str, default: int, min_value: int, max_value: int) -> int:
    raw = params.get(key)
    if raw is None or raw == "":
        raw = os.environ.get(env_key)
    try:
        value = int(raw) if raw not in (None, "") else default
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(value, max_value))


def resolve_es_runtime(params: dict) -> tuple[int, int]:
    timeout_sec = _int_setting(params, "es_timeout_sec", "SKILL_ES_TIMEOUT_SEC", DEFAULT_ES_TIMEOUT_SEC, 5, 300)
    max_retries = _int_setting(params, "es_max_retries", "SKILL_ES_MAX_RETRIES", DEFAULT_ES_MAX_RETRIES, 0, 5)
    return timeout_sec, max_retries


def es_search_timeout(timeout_sec: int) -> str:
    # Let Elasticsearch stop before the client socket timeout so the model gets a structured response.
    return f"{max(1, timeout_sec - 5)}s"


def post_json(url: str, payload: dict, timeout_sec: int, max_retries: int) -> tuple[dict, dict]:
    body = json.dumps(payload).encode("utf-8")
    attempts = []

    for attempt in range(1, max_retries + 2):
        started = time.perf_counter()
        retryable = False
        try:
            req = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            attempts.append({"attempt": attempt, "ok": True, "elapsed_ms": elapsed_ms})
            return json.loads(raw), {
                "timeout_sec": timeout_sec,
                "attempts": attempt,
                "elapsed_ms": elapsed_ms,
                "attempt_details": attempts,
            }
        except urllib.error.HTTPError as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            body_text = exc.read().decode("utf-8", errors="replace")[:500]
            retryable = exc.code in RETRYABLE_HTTP_STATUS
            message = f"HTTP {exc.code} {exc.reason}: {body_text}".strip()
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            retryable = True
            message = str(exc)
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            message = str(exc)

        attempts.append({
            "attempt": attempt,
            "ok": False,
            "elapsed_ms": elapsed_ms,
            "retryable": retryable,
            "error": message,
        })
        if not retryable or attempt > max_retries:
            raise EsRequestError(message, attempts, timeout_sec)
        time.sleep(min(2 ** (attempt - 1), 8))
