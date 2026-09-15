#!/bin/zsh
set -euo pipefail

cd "${0:A:h}"
uv sync --quiet
(sleep 1; open http://127.0.0.1:4318) &
exec uv run uvicorn app.main:app --host 127.0.0.1 --port 4318
