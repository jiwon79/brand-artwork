#!/bin/zsh
set -euo pipefail

cd "${0:A:h}"
uv sync --quiet
(sleep 1; open http://127.0.0.1:4318) &
env_args=()
if [[ -f .env.local ]]; then
  env_args=(--env-file .env.local)
fi
exec uv run "${env_args[@]}" uvicorn app.main:app --host 127.0.0.1 --port 4318
