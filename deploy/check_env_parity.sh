#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-root@59.110.81.252}"
SSH_KEY="${SSH_KEY:-/Users/chloe/Documents/00011001/1AI知识库-2405 CCSI中国船级社/CCSI.pem}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-gateway/.env}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-/srv/codex-agent/shared/.env}"
SERVICE_NAME="${SERVICE_NAME:-codex-agent-gateway}"
WORKER_DEFAULT_MODEL="${WORKER_DEFAULT_MODEL:-MiniMax-M2.7}"
WORKER_DEFAULT_PROVIDER="${WORKER_DEFAULT_PROVIDER:-openai}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

log() {
  printf '[env-parity] %s\n' "$1"
}

log "采集本地环境信息"
python3 - "${PROJECT_ROOT}" "${LOCAL_ENV_FILE}" "${WORKER_DEFAULT_MODEL}" "${WORKER_DEFAULT_PROVIDER}" > "${TMP_DIR}/local.json" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

project_root = pathlib.Path(sys.argv[1])
env_rel = sys.argv[2]
default_model = sys.argv[3]
default_provider = sys.argv[4]
env_file = project_root / env_rel

def parse_env(path: pathlib.Path):
    data = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    return data

def run_cmd(cmd):
    try:
        out = subprocess.check_output(cmd, text=True).strip()
        return out
    except Exception:
        return ""

env = parse_env(env_file)

result = {
    "scope": "local",
    "project_root": str(project_root),
    "env_file": str(env_file),
    "env_exists": env_file.exists(),
    "env_keys": sorted(env.keys()),
    "openai_base_url": env.get("OPENAI_BASE_URL", ""),
    "openai_api_key_len": len(env.get("OPENAI_API_KEY", "")),
    "skill_tagging_keys": sorted([k for k in env.keys() if k.startswith("SKILL_TAGGING_")]),
    "node_bin": run_cmd(["which", "node"]),
    "node_version": run_cmd(["node", "-v"]),
    "npm_bin": run_cmd(["which", "npm"]),
    "npm_version": run_cmd(["npm", "-v"]),
    "python_version": run_cmd(["python3", "--version"]),
    "worker_model_default": default_model,
    "worker_provider_default": default_provider,
}
print(json.dumps(result, ensure_ascii=False))
PY

log "采集远端环境信息 (${REMOTE})"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${REMOTE}" \
  "python3 - \"${REMOTE_ENV_FILE}\" \"${SERVICE_NAME}\" \"${WORKER_DEFAULT_MODEL}\" \"${WORKER_DEFAULT_PROVIDER}\" <<'PY'
import json
import pathlib
import subprocess
import sys

env_file = pathlib.Path(sys.argv[1])
service_name = sys.argv[2]
default_model = sys.argv[3]
default_provider = sys.argv[4]

def parse_env(path: pathlib.Path):
    data = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        data[k.strip()] = v.strip().strip('\"').strip(\"'\")
    return data

def run_cmd(cmd):
    try:
        return subprocess.check_output(cmd, text=True).strip()
    except Exception:
        return ''

def get_systemd_main_pid(service):
    try:
        pid = subprocess.check_output(
            ['/bin/systemctl', 'show', '-p', 'MainPID', '--value', service],
            text=True
        ).strip()
        return pid if pid and pid != '0' else ''
    except Exception:
        return ''

def read_proc_env(pid):
    env = {}
    if not pid:
        return env
    p = pathlib.Path(f'/proc/{pid}/environ')
    if not p.exists():
        return env
    for item in p.read_bytes().split(b'\\0'):
        if not item or b'=' not in item:
            continue
        k, v = item.split(b'=', 1)
        env[k.decode(errors='ignore')] = v.decode(errors='ignore')
    return env

env = parse_env(env_file)
main_pid = get_systemd_main_pid(service_name)
proc_env = read_proc_env(main_pid)

result = {
    'scope': 'remote',
    'env_file': str(env_file),
    'env_exists': env_file.exists(),
    'env_keys': sorted(env.keys()),
    'openai_base_url': env.get('OPENAI_BASE_URL', ''),
    'openai_api_key_len': len(env.get('OPENAI_API_KEY', '')),
    'skill_tagging_keys': sorted([k for k in env.keys() if k.startswith('SKILL_TAGGING_')]),
    'shell_node_bin': run_cmd(['which', 'node']),
    'shell_node_version': run_cmd(['node', '-v']),
    'system_node_version': run_cmd(['/usr/bin/node', '-v']),
    'shell_npm_bin': run_cmd(['which', 'npm']),
    'shell_npm_version': run_cmd(['npm', '-v']),
    'system_npm_version': run_cmd(['/usr/bin/npm', '-v']),
    'python_version': run_cmd(['python3', '--version']),
    'service_name': service_name,
    'service_active': run_cmd(['/bin/systemctl', 'is-active', service_name]),
    'service_main_pid': main_pid,
    'worker_node_bin_env': env.get('WORKER_NODE_BIN', ''),
    'worker_node_bin_exists': pathlib.Path(env.get('WORKER_NODE_BIN', '')).exists() if env.get('WORKER_NODE_BIN') else False,
    'worker_node_version': run_cmd([env.get('WORKER_NODE_BIN', ''), '-v']) if env.get('WORKER_NODE_BIN') and pathlib.Path(env.get('WORKER_NODE_BIN', '')).exists() else '',
    'service_env': {
        'NODE_ENV': proc_env.get('NODE_ENV', ''),
        'PORT': proc_env.get('PORT', ''),
        'OPENAI_BASE_URL': proc_env.get('OPENAI_BASE_URL', ''),
        'OPENAI_API_KEY_len': len(proc_env.get('OPENAI_API_KEY', '')),
        'WORKER_PYTHON_BIN': proc_env.get('WORKER_PYTHON_BIN', ''),
        'WORKER_NODE_BIN': proc_env.get('WORKER_NODE_BIN', ''),
        'WORKER_MODEL': proc_env.get('WORKER_MODEL', default_model),
        'WORKER_PROVIDER': proc_env.get('WORKER_PROVIDER', default_provider),
        'PATH': proc_env.get('PATH', ''),
        'HOME': proc_env.get('HOME', ''),
        'USER': proc_env.get('USER', ''),
    },
}
print(json.dumps(result, ensure_ascii=False))
PY" > "${TMP_DIR}/remote.json"

log "生成差异报告"
python3 - "${TMP_DIR}/local.json" "${TMP_DIR}/remote.json" <<'PY'
import json
import sys

local = json.loads(open(sys.argv[1], encoding="utf-8").read())
remote = json.loads(open(sys.argv[2], encoding="utf-8").read())

def print_kv(title, value):
    print(f"- {title}: {value}")

print("=== 基础信息 ===")
print_kv("本地 env 文件", local["env_file"])
print_kv("远端 env 文件", remote["env_file"])
print_kv("远端服务状态", remote.get("service_active", "unknown"))
print_kv("远端服务 PID", remote.get("service_main_pid", ""))
print()

print("=== 版本/二进制 ===")
print_kv("本地 node", f'{local.get("node_version","")} ({local.get("node_bin","")})')
print_kv("远端 shell node", f'{remote.get("shell_node_version","")} ({remote.get("shell_node_bin","")})')
print_kv("远端 system node", remote.get("system_node_version",""))
print_kv("本地 npm", f'{local.get("npm_version","")} ({local.get("npm_bin","")})')
print_kv("远端 shell npm", f'{remote.get("shell_npm_version","")} ({remote.get("shell_npm_bin","")})')
print_kv("远端 system npm", remote.get("system_npm_version",""))
print_kv("本地 python", local.get("python_version",""))
print_kv("远端 python", remote.get("python_version",""))
print()

print("=== OpenAI 关键配置（脱敏） ===")
print_kv("本地 OPENAI_BASE_URL", local.get("openai_base_url",""))
print_kv("远端 OPENAI_BASE_URL(.env)", remote.get("openai_base_url",""))
print_kv("远端 OPENAI_BASE_URL(进程)", remote.get("service_env",{}).get("OPENAI_BASE_URL",""))
print_kv("本地 OPENAI_API_KEY 长度", local.get("openai_api_key_len",0))
print_kv("远端 OPENAI_API_KEY 长度(.env)", remote.get("openai_api_key_len",0))
print_kv("远端 OPENAI_API_KEY 长度(进程)", remote.get("service_env",{}).get("OPENAI_API_KEY_len",0))
print()

print("=== Worker 相关配置 ===")
svc_env = remote.get("service_env", {})
print_kv("远端 WORKER_MODEL(进程)", svc_env.get("WORKER_MODEL",""))
print_kv("远端 WORKER_PROVIDER(进程)", svc_env.get("WORKER_PROVIDER",""))
print_kv("远端 WORKER_PYTHON_BIN(进程)", svc_env.get("WORKER_PYTHON_BIN",""))
print_kv("远端 WORKER_NODE_BIN(.env)", remote.get("worker_node_bin_env",""))
print_kv("远端 WORKER_NODE_BIN(进程)", svc_env.get("WORKER_NODE_BIN",""))
print_kv("远端 worker node 版本", remote.get("worker_node_version",""))
print_kv("远端 worker node 文件存在", remote.get("worker_node_bin_exists", False))
print()

print("=== 环境变量键差异 ===")
local_keys = set(local.get("env_keys", []))
remote_keys = set(remote.get("env_keys", []))
only_local = sorted(local_keys - remote_keys)
only_remote = sorted(remote_keys - local_keys)
print_kv("仅本地存在", only_local if only_local else "无")
print_kv("仅远端存在", only_remote if only_remote else "无")
print_kv("本地 SKILL_TAGGING_*", local.get("skill_tagging_keys", []))
print_kv("远端 SKILL_TAGGING_*", remote.get("skill_tagging_keys", []))
PY

log "完成"
