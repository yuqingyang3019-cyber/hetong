#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

export PYTHONPATH="$(pwd)/python:${PYTHONPATH:-}"

if python3 -c "import uvicorn" >/dev/null 2>&1; then
  exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-9000}"
fi

TARGET_DIR="/tmp/hetong-python"
REQ_HASH="$(python3 - <<'PY'
import hashlib
from pathlib import Path
print(hashlib.sha256(Path("requirements.txt").read_bytes()).hexdigest())
PY
)"
HASH_FILE="$TARGET_DIR/.requirements.sha256"
if [ ! -x "$TARGET_DIR/bin/uvicorn" ] || [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$REQ_HASH" ]; then
  rm -rf "$TARGET_DIR"
  python3 -m venv "$TARGET_DIR"
  "$TARGET_DIR/bin/python" -m pip install --no-cache-dir -r requirements.txt
  echo "$REQ_HASH" > "$HASH_FILE"
fi

exec "$TARGET_DIR/bin/python" -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-9000}"
