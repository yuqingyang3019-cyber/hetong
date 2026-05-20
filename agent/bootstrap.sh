#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

TARGET_DIR="/tmp/hetong-python"
if [ ! -x "$TARGET_DIR/bin/uvicorn" ]; then
  rm -rf "$TARGET_DIR"
  python3 -m venv "$TARGET_DIR"
  "$TARGET_DIR/bin/python" -m pip install --no-cache-dir -r requirements.txt
fi

exec "$TARGET_DIR/bin/python" -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-9000}"
