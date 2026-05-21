#!/bin/bash
set -e

export PORT="${PORT:-8000}"
python3 server.py
