#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Node.js 22+ and npm must be installed and available on PATH.\n' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  printf 'Dependencies are missing. Run npm install and npm run browser:install in %s first.\n' "$PWD" >&2
  exit 1
fi

npm run build >&2
exec node dist/index.js
