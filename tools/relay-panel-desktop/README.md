# Codex Relay 控制面板（桌面版）

一个 **Electron 桌面应用**，把"控制面板 + Relay 服务器"打包在一起：

- 双击即可运行，无需开终端、无需安装 Node / pnpm
- **自带完整 Relay 服务器**（`codex-relay` 构建产物 + 运行时依赖 + native 模块）
- 功能与网页版一致：一键启动 17878 服务、显示配对二维码（公网/局域网）、输入配对码批准设备、查看日志

## Mac 使用

构建产物：`dist/Codex Relay 控制面板-1.0.0-arm64.dmg`

1. 双击打开 DMG，把 App 拖到「应用程序」
2. 首次打开若提示"无法验证开发者"，请 **右键 → 打开**，或到
   「系统设置 → 隐私与安全性」允许运行
3. 打开 App 后，窗口内点「🚀 启动服务」即可启动自带服务器并显示二维码

## Windows 构建

由于 Relay 服务器的 native 模块是平台相关的，**Windows 安装包需要在 Windows 上构建**：

```bash
cd tools/relay-panel-desktop
npm install
npm run prebuild        # 复制面板 + 服务器，并安装 Windows 版运行时依赖
npm run build:win       # 生成 NSIS 安装包（dist/ 下）
```

## 开发运行

```bash
cd tools/relay-panel-desktop
npm install
npm start               # Electron 开发模式（自动启动面板后端）
```

## 结构说明

- `main.js`：Electron 主进程，启动面板后端子进程并打开窗口
- `scripts/prepare-vendor.mjs`：构建前把面板 + Relay 服务器复制进 `vendor/`，
  并安装自包含的运行时依赖
- `vendor/server.mjs`：面板后端（复用 `tools/relay-panel/server.mjs`）
- `vendor/public/`：面板前端
- `vendor/relay-server/`：自带的 codex-relay 服务器（dist + node_modules）

打包时 `vendor/relay-server` 通过 `extraResources` 放到 `Contents/Resources/relay-server`，
保证 native 模块（libsql / es-git / node-pty）能正常加载。
