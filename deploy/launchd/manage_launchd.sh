#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-restart}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${PROJECT_ROOT}/logs/launchd"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
TAGGING_ENV_FILE="${TAGGING_ENV_FILE:-${PROJECT_ROOT}/deploy/launchd/tagging.env}"

GATEWAY_LABEL="com.chloe.codex-agent.gateway"
FRONTEND_LABEL="com.chloe.codex-agent.frontend"
GATEWAY_PLIST="${LAUNCH_AGENTS_DIR}/${GATEWAY_LABEL}.plist"
FRONTEND_PLIST="${LAUNCH_AGENTS_DIR}/${FRONTEND_LABEL}.plist"
TAGGING_ENV_XML=""

mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node/npm 未找到，请先安装后再执行。"
  exit 1
fi

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "${value}"
}

append_tagging_env_xml() {
  local key="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    return
  fi
  TAGGING_ENV_XML="${TAGGING_ENV_XML}    <key>${key}</key>
    <string>$(xml_escape "${value}")</string>
"
}

load_tagging_env() {
  TAGGING_ENV_XML=""
  if [[ -f "${TAGGING_ENV_FILE}" ]]; then
    while IFS= read -r line || [[ -n "${line}" ]]; do
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -z "${line}" || "${line:0:1}" == "#" ]] && continue
      if [[ "${line}" == export\ * ]]; then
        line="${line#export }"
      fi
      [[ "${line}" != *=* ]] && continue

      local key="${line%%=*}"
      local value="${line#*=}"
      key="${key//[[:space:]]/}"

      if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi

      case "${key}" in
        SKILL_TAGGING_API_KEY|SKILL_TAGGING_BASE_URL|SKILL_TAGGING_MODEL|SKILL_TAGGING_PROXY|SKILL_TAGGING_GATEWAY_URL|SKILL_TAGGING_GATEWAY_MODEL|SKILL_TAGGING_GATEWAY_API_KEY|SKILL_TAGGING_ENV|SKILL_TAGGING_TIMEOUT_SEC)
          export "${key}=${value}"
          ;;
      esac
    done < "${TAGGING_ENV_FILE}"
  fi

  append_tagging_env_xml "SKILL_TAGGING_API_KEY" "${SKILL_TAGGING_API_KEY:-}"
  append_tagging_env_xml "SKILL_TAGGING_BASE_URL" "${SKILL_TAGGING_BASE_URL:-}"
  append_tagging_env_xml "SKILL_TAGGING_MODEL" "${SKILL_TAGGING_MODEL:-}"
  append_tagging_env_xml "SKILL_TAGGING_PROXY" "${SKILL_TAGGING_PROXY:-}"
  append_tagging_env_xml "SKILL_TAGGING_GATEWAY_URL" "${SKILL_TAGGING_GATEWAY_URL:-}"
  append_tagging_env_xml "SKILL_TAGGING_GATEWAY_MODEL" "${SKILL_TAGGING_GATEWAY_MODEL:-}"
  append_tagging_env_xml "SKILL_TAGGING_GATEWAY_API_KEY" "${SKILL_TAGGING_GATEWAY_API_KEY:-}"
  append_tagging_env_xml "SKILL_TAGGING_ENV" "${SKILL_TAGGING_ENV:-}"
  append_tagging_env_xml "SKILL_TAGGING_TIMEOUT_SEC" "${SKILL_TAGGING_TIMEOUT_SEC:-}"
}

render_gateway_plist() {
  cat > "${GATEWAY_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${GATEWAY_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}/gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
${TAGGING_ENV_XML}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/gateway.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/gateway.stderr.log</string>
</dict>
</plist>
EOF
}

render_frontend_plist() {
  cat > "${FRONTEND_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${FRONTEND_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}/frontend</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM_BIN}</string>
    <string>run</string>
    <string>dev</string>
    <string>--</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>5179</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/frontend.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/frontend.stderr.log</string>
</dict>
</plist>
EOF
}

write_plists() {
  load_tagging_env
  render_gateway_plist
  render_frontend_plist
}

unload_if_loaded() {
  local plist_path="$1"
  launchctl bootout "gui/$(id -u)" "${plist_path}" >/dev/null 2>&1 || true
}

load_plist() {
  local plist_path="$1"
  launchctl bootstrap "gui/$(id -u)" "${plist_path}"
}

kickstart_label() {
  local label="$1"
  launchctl kickstart -k "gui/$(id -u)/${label}"
}

print_status() {
  launchctl list | rg "com.chloe.codex-agent.(gateway|frontend)" || true
  printf "\nGateway log: %s\n" "${LOG_DIR}/gateway.stdout.log"
  printf "Frontend log: %s\n" "${LOG_DIR}/frontend.stdout.log"
}

case "${ACTION}" in
  install)
    write_plists
    unload_if_loaded "${GATEWAY_PLIST}"
    unload_if_loaded "${FRONTEND_PLIST}"
    load_plist "${GATEWAY_PLIST}"
    load_plist "${FRONTEND_PLIST}"
    ;;
  restart)
    write_plists
    unload_if_loaded "${GATEWAY_PLIST}"
    unload_if_loaded "${FRONTEND_PLIST}"
    load_plist "${GATEWAY_PLIST}"
    load_plist "${FRONTEND_PLIST}"
    kickstart_label "${GATEWAY_LABEL}"
    kickstart_label "${FRONTEND_LABEL}"
    ;;
  stop)
    unload_if_loaded "${GATEWAY_PLIST}"
    unload_if_loaded "${FRONTEND_PLIST}"
    ;;
  status)
    ;;
  *)
    echo "Usage: $0 [install|restart|stop|status]"
    exit 1
    ;;
esac

print_status
