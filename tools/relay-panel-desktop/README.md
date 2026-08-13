# Codex Relay 控制面板（桌面版）

一个 **Electron 桌面应用**，把"控制面板 + Relay 服务器"打包在一起：

- 双击即可运行，无需开终端、无需安装 Node / pnpm
- **自带完整 Relay 服务器**（`codex-relay` 构建产物 + 运行时依赖 + native 模块）
- **自带 Node.js 22 运行时**，Windows/macOS 都直接用内置 Node 启动 Relay
- 功能与网页版一致：一键启动 17878 服务、显示配对二维码（公网/局域网）、输入配对码批准设备、查看日志
- Windows 版内置「修复 Windows 防火墙」按钮，手机连不上局域网地址时可一键添加放行规则

## 构建

仓库根目录提供了跨平台构建命令：

```bash
# macOS DMG
pnpm panel:desktop:build:mac

# Windows NSIS 安装包
pnpm panel:desktop:build:win
```

`tools/relay-panel-desktop` 的 `vendor/relay-server` 会安装当前平台的 native 依赖，
所以 **Windows 安装包必须在 Windows 上构建**。可以直接在 Windows 机器上跑上面的命令，
也可以用仓库里的 `.github/workflows/desktop-panel.yml`，通过 GitHub Actions 同时产出
Mac 和 Windows 安装包。

## Mac 使用

构建产物：`dist/Codex-Relay-Panel-1.1.0-mac-arm64.dmg`

1. 双击打开 DMG，把 App 拖到「应用程序」
2. 首次打开若提示"无法验证开发者"，请 **右键 → 打开**，或到
   「系统设置 → 隐私与安全性」允许运行
3. 打开 App 后，窗口内点「🚀 启动服务」即可启动自带服务器并显示二维码

## Windows 使用

构建产物：`dist/Codex-Relay-Panel-1.1.0-win-x64.exe`

```bash
cd tools/relay-panel-desktop
npm install
npm run build:win
```

安装后打开「Codex Relay 控制面板」，点「🚀 启动服务」即可。

## 开发运行

```bash
cd tools/relay-panel-desktop
npm install
npm start               # Electron 开发模式（自动启动面板后端）
```

## 结构说明

- `main.js`：Electron 主进程，启动面板后端子进程并打开窗口
- 面板和 Relay 都以 `ELECTRON_RUN_AS_NODE=1` 作为 Node 进程运行，Windows/macOS 均可使用
- `scripts/prepare-vendor.mjs`：构建前把面板 + Relay 服务器复制进 `vendor/`，
  并安装自包含的运行时依赖
- `vendor/server.mjs`：面板后端（复用 `tools/relay-panel/server.mjs`）
- `vendor/public/`：面板前端
- `vendor/relay-server/`：自带的 codex-relay 服务器（dist + node_modules）

打包时 `vendor/relay-server` 通过 `extraResources` 放到 `Contents/Resources/relay-server`，
保证 native 模块（libsql / es-git / node-pty）能正常加载。
