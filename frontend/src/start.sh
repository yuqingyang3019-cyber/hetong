#!/bin/bash
set -e

cd "$(dirname "$0")"
export PORT="${PORT:-8000}"
export PYTHONPATH="$(pwd)/python:${PYTHONPATH:-}"

if python3 -c "from alibabacloud_dingtalk.oauth2_1_0.client import Client" >/dev/null 2>&1; then
  exec python3 server.py
fi

TARGET_DIR="/tmp/hetong-h5-python"
if [ ! -x "$TARGET_DIR/bin/python" ] || ! "$TARGET_DIR/bin/python" -c "from alibabacloud_dingtalk.oauth2_1_0.client import Client" >/dev/null 2>&1; then
  rm -rf "$TARGET_DIR"
  python3 -m venv "$TARGET_DIR"
  "$TARGET_DIR/bin/python" -m pip install --no-cache-dir -r requirements.txt
fi

exec "$TARGET_DIR/bin/python" server.py
