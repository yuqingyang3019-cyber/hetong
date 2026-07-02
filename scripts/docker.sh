#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env() {
  if [ ! -f .env.local ]; then
    echo "缺少 .env.local，请复制 .env.docker.example 并填写。" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
}

image_ref() {
  load_env
  : "${ACR_REGISTRY:?请在 .env.local 配置 ACR_REGISTRY}"
  : "${ACR_NAMESPACE:?请在 .env.local 配置 ACR_NAMESPACE}"
  : "${ACR_REPOSITORY:?请在 .env.local 配置 ACR_REPOSITORY}"
  echo "${ACR_REGISTRY}/${ACR_NAMESPACE}/${ACR_REPOSITORY}:${1:-latest}"
}

usage() {
  cat <<'EOF'
用法: scripts/docker.sh <command> [tag]

  build         本地构建镜像（含前端打包）
  up            构建并启动容器
  down          停止容器
  pull [tag]    登录 ACR 并拉取镜像（默认 latest）
  run-pulled [tag]  运行已拉取的 ACR 镜像
  smoke         检查 http://127.0.0.1:9000/health
EOF
}

cmd="${1:-}"
if [ -z "$cmd" ]; then
  usage
  exit 1
fi
shift || true

case "$cmd" in
  build)
    docker compose build
    ;;
  up)
    docker compose up --build
    ;;
  down)
    docker compose down
    ;;
  pull)
    load_env
    : "${ACR_USERNAME:?请在 .env.local 配置 ACR_USERNAME}"
    : "${ACR_PASSWORD:?请在 .env.local 配置 ACR_PASSWORD}"
    echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" -u "$ACR_USERNAME" --password-stdin
    docker pull "$(image_ref "${1:-latest}")"
    ;;
  run-pulled)
    docker run --rm -it -p 9000:9000 --env-file .env.local \
      -e PORT=9000 \
      -e H5_STATIC_DIR=/code/static \
      -e PYTHONPATH=/code \
      -v "$ROOT/agent/storage:/code/storage" \
      "$(image_ref "${1:-latest}")"
    ;;
  smoke)
    curl --fail-with-body --connect-timeout 5 --max-time 30 "http://127.0.0.1:9000/health"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "未知命令: $cmd" >&2
    usage
    exit 1
    ;;
esac
