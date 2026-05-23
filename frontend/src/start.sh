#!/bin/bash
set -e

cd "$(dirname "$0")"
export PORT="${PORT:-8000}"

exec node index.cjs
