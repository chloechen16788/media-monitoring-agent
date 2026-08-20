#!/usr/bin/env bash
set -euo pipefail

# 优先使用系统 node/npm，避免被 root 的 nvm 覆盖。
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"

APP_ROOT="${APP_ROOT:-/srv/codex-agent}"
PUBLIC_PORT="${PUBLIC_PORT:-8094}"
SERVER_NAME="${SERVER_NAME:-59.110.81.252}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SERVICE_NAME="${SERVICE_NAME:-codex-agent-gateway}"

RELEASES_DIR="$APP_ROOT/releases"
INCOMING_DIR="$APP_ROOT/incoming"
SHARED_DIR="$APP_ROOT/shared"
CURRENT_LINK="$APP_ROOT/current"

NGINX_SITE="/etc/nginx/sites-available/codex-agent.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/codex-agent.conf"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

log() {
  printf '[deploy] %s\n' "$1"
}

abort() {
  printf '[deploy][error] %s\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    abort "请使用 root 执行远程部署脚本。"
  fi
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    gnupg \
    nginx \
    python3 \
    python3-pip \
    rsync
}

ensure_node22() {
  local node_bin="/usr/bin/node"
  local need_install="true"
  if [[ -x "${node_bin}" ]]; then
    local major
    major="$("${node_bin}" -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" -ge 22 ]]; then
      need_install="false"
    fi
  fi

  if [[ "${need_install}" == "false" ]]; then
    log "Node.js $(${node_bin} -v) 已满足 >=22，跳过安装。"
    return
  fi

  log "安装 Node.js 22（NodeSource）。"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  local major
  major="$("${node_bin}" -p "process.versions.node.split('.')[0]")"
  if [[ "${major}" -lt 22 ]]; then
    abort "Node.js 安装失败，当前版本: $(${node_bin} -v)"
  fi
}

ensure_worker_node20() {
  local target="${SHARED_DIR}/bin/node20"
  mkdir -p "${SHARED_DIR}/bin"

  if [[ -x "${target}" ]]; then
    local major
    major="$("${target}" -p "process.versions.node.split('.')[0]")"
    if [[ "${major}" == "20" ]]; then
      log "Worker Node20 已存在: $(${target} -v)"
      chown codex:codex "${target}"
      chmod 755 "${target}"
      return
    fi
  fi

  local source=""
  local candidate
  shopt -s nullglob
  for candidate in \
    /root/.nvm/versions/node/v20.*/bin/node \
    /usr/local/bin/node20; do
    if [[ -x "${candidate}" ]]; then
      source="${candidate}"
      break
    fi
  done
  shopt -u nullglob

  if [[ -z "${source}" ]]; then
    local node_version="v20.19.6"
    local node_arch="linux-x64"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    log "未找到本机 Node20，下载官方二进制 ${node_version} -> ${target}"
    curl -fsSL "https://nodejs.org/dist/${node_version}/node-${node_version}-${node_arch}.tar.xz" \
      -o "${tmp_dir}/node.tar.xz"
    tar -xJf "${tmp_dir}/node.tar.xz" -C "${tmp_dir}" "node-${node_version}-${node_arch}/bin/node"
    cp "${tmp_dir}/node-${node_version}-${node_arch}/bin/node" "${target}"
    rm -rf "${tmp_dir}"
  else
    log "复制 Node20: ${source} -> ${target}"
    cp "${source}" "${target}"
  fi

  chown codex:codex "${target}"
  chmod 755 "${target}"
  log "Worker Node20 就绪: $(${target} -v)"
}

ensure_env_worker_node_bin() {
  local env_file="${SHARED_DIR}/.env"
  local worker_node_bin="${SHARED_DIR}/bin/node20"
  local line="WORKER_NODE_BIN=${worker_node_bin}"

  if grep -q '^WORKER_NODE_BIN=' "${env_file}"; then
    sed -i "s|^WORKER_NODE_BIN=.*|${line}|" "${env_file}"
  else
    printf '%s\n' "${line}" >> "${env_file}"
  fi
}

ensure_runtime_user_and_dirs() {
  if ! id -u codex >/dev/null 2>&1; then
    useradd --system --home "${APP_ROOT}" --shell /usr/sbin/nologin codex
  fi

  mkdir -p "${RELEASES_DIR}" "${INCOMING_DIR}" "${SHARED_DIR}/bin" "${SHARED_DIR}/data/gateway" "${SHARED_DIR}/logs"
  touch "${SHARED_DIR}/data/gateway/database.sqlite"

  if [[ ! -f "${SHARED_DIR}/.env" ]]; then
    cat > "${SHARED_DIR}/.env" <<EOF
PORT=3000
WORKER_PYTHON_BIN=python3
WORKER_NODE_BIN=${SHARED_DIR}/bin/node20
EOF
  fi

  ensure_worker_node20
  ensure_env_worker_node_bin

  chown -R codex:codex "${APP_ROOT}"
  chmod 640 "${SHARED_DIR}/.env"
}

npm_install() {
  local npm_bin="/usr/bin/npm"
  if [[ -f package-lock.json ]]; then
    if ! "${npm_bin}" ci --legacy-peer-deps; then
      log "npm ci 失败，回退到 npm install"
      "${npm_bin}" install --legacy-peer-deps
    fi
  else
    "${npm_bin}" install --legacy-peer-deps
  fi
}

render_template() {
  local source="$1"
  local target="$2"
  sed \
    -e "s|__APP_ROOT__|${APP_ROOT}|g" \
    -e "s|__PUBLIC_PORT__|${PUBLIC_PORT}|g" \
    -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    "${source}" > "${target}"
}

wait_http_ok() {
  local url="$1"
  local retries="${2:-20}"
  local sleep_sec="${3:-1}"
  local i
  for ((i = 1; i <= retries; i++)); do
    if curl -fsS "${url}" >/dev/null; then
      return 0
    fi
    sleep "${sleep_sec}"
  done
  return 1
}

main() {
  require_root
  [[ -d "${INCOMING_DIR}" ]] || abort "未找到 incoming 目录：${INCOMING_DIR}"

  log "1/9 安装基础依赖"
  install_base_packages
  ensure_node22

  log "2/9 初始化运行用户与共享目录"
  ensure_runtime_user_and_dirs

  local release_id
  release_id="$(date +%Y%m%d%H%M%S)"
  local new_release="${RELEASES_DIR}/${release_id}"
  mkdir -p "${new_release}"

  log "3/9 同步 incoming 到新版本目录: ${new_release}"
  rsync -a --delete "${INCOMING_DIR}/" "${new_release}/"

  [[ -d "${new_release}/gateway" ]] || abort "源码不完整：缺少 gateway 目录。"
  [[ -d "${new_release}/frontend" ]] || abort "源码不完整：缺少 frontend 目录。"
  [[ -d "${new_release}/agent-core" ]] || abort "源码不完整：缺少 agent-core 目录。"

  log "4/9 安装依赖并构建"
  # V3：worker 由 agent-core 提供（gateway 默认 WORKER_PATH 指向 agent-core/dist/worker.js）。
  pushd "${new_release}/agent-core" >/dev/null
  npm_install
  /usr/bin/npm run build
  popd >/dev/null

  pushd "${new_release}/gateway" >/dev/null
  npm_install
  /usr/bin/npm rebuild sqlite3 --build-from-source
  popd >/dev/null

  pushd "${new_release}/frontend" >/dev/null
  npm_install
  VITE_API_BASE=/api /usr/bin/npm run build
  popd >/dev/null

  if [[ -f "${new_release}/skills/requirements-min.txt" ]]; then
    log "安装 Python 最小依赖 requirements-min.txt"
    python3 -m pip install --break-system-packages -r "${new_release}/skills/requirements-min.txt"
  fi

  log "5/9 连接持久化数据目录"
  ln -sfn "${SHARED_DIR}/data" "${new_release}/data"
  ln -sfn "${SHARED_DIR}/data/gateway/database.sqlite" "${new_release}/gateway/database.sqlite"

  local prev_release=""
  if [[ -L "${CURRENT_LINK}" ]]; then
    prev_release="$(readlink -f "${CURRENT_LINK}" || true)"
  fi

  log "6/9 切换 current 到新版本"
  ln -sfn "${new_release}" "${CURRENT_LINK}"

  log "7/9 安装 systemd 服务与 nginx 配置"
  local rendered_service="/tmp/${SERVICE_NAME}.service"
  local rendered_nginx="/tmp/codex-agent.conf"
  render_template "${CURRENT_LINK}/deploy/templates/codex-agent-gateway.service" "${rendered_service}"
  render_template "${CURRENT_LINK}/deploy/templates/nginx-codex-agent.conf" "${rendered_nginx}"

  install -m 644 "${rendered_service}" "${SERVICE_PATH}"
  install -m 644 "${rendered_nginx}" "${NGINX_SITE}"
  ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"
  rm -f /etc/nginx/sites-enabled/default

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  if ! systemctl restart "${SERVICE_NAME}"; then
    if [[ -n "${prev_release}" ]]; then
      log "新版本启动失败，回滚到 ${prev_release}"
      ln -sfn "${prev_release}" "${CURRENT_LINK}"
      systemctl restart "${SERVICE_NAME}" || true
    fi
    abort "gateway 启动失败。"
  fi

  nginx -t
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl enable --now nginx
  fi

  log "8/9 执行基础健康检查"
  wait_http_ok "http://127.0.0.1:3000/api/projects?userId=1001" 30 1
  wait_http_ok "http://127.0.0.1:${PUBLIC_PORT}/api/projects?userId=1001" 30 1

  log "9/9 清理旧版本（保留最近 ${KEEP_RELEASES} 个）"
  local current_target
  current_target="$(readlink -f "${CURRENT_LINK}")"
  while IFS= read -r old_dir; do
    [[ -z "${old_dir}" ]] && continue
    if [[ "$(readlink -f "${old_dir}")" == "${current_target}" ]]; then
      continue
    fi
    rm -rf "${old_dir}"
  done < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))")

  log "部署完成。当前版本: ${new_release}"
  log "访问地址: http://${SERVER_NAME}:${PUBLIC_PORT}"
}

main "$@"
