#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-root@59.110.81.252}"
SSH_KEY="${SSH_KEY:-/Users/chloe/Documents/00011001/1AI知识库-2405 CCSI中国船级社/CCSI.pem}"
REMOTE_APP_ROOT="${REMOTE_APP_ROOT:-/srv/codex-agent}"
PUBLIC_PORT="${PUBLIC_PORT:-8094}"
SERVER_NAME="${SERVER_NAME:-59.110.81.252}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSYNC_RSH="ssh -i \"${SSH_KEY}\" -o StrictHostKeyChecking=accept-new"

log() {
  printf '[push] %s\n' "$1"
}

log "1/3 检查 SSH 连接"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${REMOTE}" "mkdir -p '${REMOTE_APP_ROOT}/incoming'"

log "2/3 同步源码到远端 incoming"
rsync -az --delete \
  -e "${RSYNC_RSH}" \
  --exclude ".git" \
  --exclude ".cursor" \
  --exclude ".firecrawl" \
  --exclude "node_modules" \
  --exclude "venv" \
  --exclude "workspace" \
  --exclude "sessions" \
  --exclude "chroma_db" \
  --exclude "models" \
  --exclude "*.log" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  "${PROJECT_ROOT}/" "${REMOTE}:${REMOTE_APP_ROOT}/incoming/"

log "3/3 触发远端部署"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${REMOTE}" \
  "APP_ROOT='${REMOTE_APP_ROOT}' PUBLIC_PORT='${PUBLIC_PORT}' SERVER_NAME='${SERVER_NAME}' KEEP_RELEASES='${KEEP_RELEASES}' bash '${REMOTE_APP_ROOT}/incoming/deploy/deploy_remote.sh'"

log "部署已触发，访问: http://${SERVER_NAME}:${PUBLIC_PORT}"
