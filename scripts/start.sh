#!/usr/bin/env bash
# 卫戍协议：盟约 · macOS / Linux start script. Docs: docs/DEPLOY.md
#   scripts/start.sh [--port 4000] [--legacy-port 4001] [--no-open] [--no-local] [--no-assets] …
# Checks Node.js ≥ 22, then tools/start-versions.mjs prepares and starts both versions and opens the browser.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js（需要 22 或更高，22 / 24 LTS）。Node.js not found."
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  安装：brew install node@22   或   https://nodejs.org/zh-cn/download"
  else
    echo "  安装：https://nodejs.org/zh-cn/download （或发行版的包管理器 / nvm / fnm）"
  fi
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"; then
  echo "Node.js $(node -v) 太旧，需要 22 或更高（22 / 24 LTS）：https://nodejs.org/zh-cn/download"
  exit 1
fi

exec node tools/start-versions.mjs "$@"
