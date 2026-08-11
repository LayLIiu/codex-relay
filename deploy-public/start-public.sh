#!/usr/bin/env bash
# =============================================================
#  Codex Relay 公网启动脚本（基于干净版 codex-relay-main-2）
#  用法： ./start-public.sh
#  说明： 默认公网 47.102.141.228:17878，可用环境变量覆盖
# =============================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/Users/liujie/Downloads/codex-relay-main-2}"
PUBLIC_IP="${PUBLIC_IP:-47.102.141.228}"
LOCAL_PORT="${LOCAL_PORT:-17878}"    # 本地监听端口（frpc 转发源）
PUBLIC_PORT="${PUBLIC_PORT:-8789}"   # frp 公网端口（remotePort，见 ~/.codex-relay/frpc.toml）

cd "$PROJECT_DIR"

export HOST="${HOST:-0.0.0.0}"
export PORT="$LOCAL_PORT"
export CODEX_RELAY_PUBLIC_URL="${CODEX_RELAY_PUBLIC_URL:-http://${PUBLIC_IP}:${PUBLIC_PORT}}"

echo "============================================================="
echo "  Codex Relay 启动参数"
echo "  本地监听   : ${HOST}:${LOCAL_PORT}"
echo "  公网配对URL: ${CODEX_RELAY_PUBLIC_URL}"
echo "  配对方式   : 用手机 App 扫描下方二维码"
echo "============================================================="

# 开发模式（自动重启、健康检查守护）：
pnpm dev

# 生产模式（先 build 再运行）请改用下面这行：
# pnpm --filter codex-relay build && node packages/codex-relay/dist/cli.js
