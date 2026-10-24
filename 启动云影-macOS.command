#!/bin/bash
# 云影 · NAS 媒体中心 —— macOS 启动器
# 优先启动真正的桌面客户端（云影.app）；没有客户端时才退回 Chrome 应用窗口模式
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}"
APP="$PWD/云影.app"

# ---- 首选：原生客户端（自带本地服务、自带窗口、关窗即退出） ----
if [ -d "$APP" ]; then
  echo "正在启动云影客户端…"
  open "$APP" || true
  sleep 3
  if pgrep -f "$APP/Contents/MacOS/云影" >/dev/null 2>&1; then
    echo "✅ 客户端已启动，窗口应该已经出来了。"
    exit 0
  fi
  echo "⚠️  客户端没能起来（可能被系统拦截），改用浏览器窗口模式。"
  echo "    若提示“已阻止恶意软件”，请在终端执行："
  echo "    xattr -cr \"$APP\" && codesign --force --deep --sign - \"$APP\""
fi

# ---- 找 Node：Finder 启动的终端只有系统 PATH，Node 常装在 volta / nvm / homebrew 里 ----
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  local c
  for c in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/bin/node"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  # nvm：取最新版本
  c=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  # WorkBuddy 自带的运行时
  c=$(ls -d "$HOME"/.workbuddy-ai/binaries/node/versions/*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  return 1
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  echo "未检测到 Node.js，请先安装：https://nodejs.org/"
  osascript -e 'display alert "缺少 Node.js" message "请先安装 Node.js（18 以上版本）后再运行云影。"'
  exit 1
fi
echo "使用 Node：$NODE"

mkdir -p data

if ! curl -s --noproxy '*' --max-time 1 "${URL}/api/state" >/dev/null 2>&1; then
  echo "正在启动云影服务…"
  nohup "$NODE" server.js >> data/server.log 2>&1 &
  for _ in $(seq 1 80); do
    sleep 0.25
    if curl -s --noproxy '*' --max-time 1 "${URL}/api/state" >/dev/null 2>&1; then break; fi
  done
fi

if ! curl -s --noproxy '*' --max-time 1 "${URL}/api/state" >/dev/null 2>&1; then
  echo "启动失败，请查看 data/server.log"
  osascript -e 'display alert "云影启动失败" message "请查看 data/server.log 了解详情。"'
  exit 1
fi

# ---- 连不上群晖时，把真实原因直接打在终端窗口里 ----
echo "正在检查与群晖的连接…"
CHECK="$(curl -s --noproxy '*' --max-time 25 "${URL}/api/selfcheck")"
echo "$CHECK"
case "$CHECK" in
  *'"ok":true'*)
    echo "✅ 群晖连接正常，媒体库可以用了。"
    ;;
  *"本地网络"*|*"无法访问"*)
    echo "⚠️  系统拦截了局域网访问。请打开 系统设置 → 隐私与安全性 → 本地网络，"
    echo "    把「终端」打开（若列表里没有，点左下角 + 手动添加 /Applications/Utilities/Terminal.app），"
    echo "    然后完全退出本窗口，重新双击本脚本。"
    ;;
  *)
    echo "⚠️  连接群晖失败，上面是具体原因。"
    ;;
esac

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  open -na "Google Chrome" --args --app="${URL}" --window-size=1440,900 --no-first-run
else
  open "${URL}"
fi
