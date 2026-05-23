#!/bin/bash
set -e

cd "$(dirname "$0")"
export PORT="${PORT:-8000}"
export PYTHONPATH="$(pwd)/python:${PYTHONPATH:-}"

if [ ! -d "$(pwd)/python" ]; then
  echo "frontend/python 依赖目录不存在，请确认 CI 已执行 Vendor H5 Python dependencies" >&2
  exit 2
fi

if ! python3 -c "from alibabacloud_dingtalk.oauth2_1_0.client import Client" >/dev/null 2>&1; then
  echo "H5 Python 依赖不完整：缺少 alibabacloud_dingtalk.oauth2_1_0.client，请检查 frontend/dist/python 打包结果" >&2
  exit 2
fi

exec python3 server.py
