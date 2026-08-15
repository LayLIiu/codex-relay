# Codex Relay for HarmonyOS

<p align="center">
  <img src="./docs/readme-assets/icon.png" alt="Codex Relay icon" width="96" />
</p>

<p align="center">
  <strong>用鸿蒙手机遥控电脑上的 Codex，电脑继续干活，手机随时跟进。</strong>
</p>

<p align="center">
  <img alt="HarmonyOS" src="https://img.shields.io/badge/platform-HarmonyOS-111111?style=flat-square">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22.14-111111?style=flat-square">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-%3E%3D11-111111?style=flat-square">
  <img alt="Relay port" src="https://img.shields.io/badge/port-17878-111111?style=flat-square">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-111111?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-111111?style=flat-square">
</p>

## 这是什么

Codex Relay for HarmonyOS 是一个面向鸿蒙用户的 Codex 远程控制方案：

1. 电脑端运行 Relay 服务，接管本机 Codex CLI 或 macOS Codex Desktop。
2. 鸿蒙手机通过局域网、Tailscale 或公网与 Relay 配对。
3. 配对后，手机可以实时查看电脑端 Codex 的流式输出，继续会话、暂停、审批、选择模型和查看工作区状态。

这个项目是独立开发项目，与 OpenAI 及其 Codex 团队没有任何关联、背书或赞助关系。

## 适合谁

- 使用鸿蒙手机的用户。
- 希望出门后继续电脑端 Codex 会话的用户。
- 需要同时使用 CLI 会话和 Codex Desktop 会话的用户。
- 想在本机跑 Relay，不想把代码或会话数据交给第三方服务的用户。

## 核心能力

- 把电脑端 Codex 会话实时推送到鸿蒙手机。
- 从手机发起新对话、继续旧对话、暂停或停止运行。
- 支持 CLI 会话和 macOS 桌面端会话，可手动切换。
- 支持模型、推理强度、服务档位等运行参数同步。
- 支持审批请求、排队输入和需要操作的通知。
- 支持查看工作区 Git 状态、文件、Web 预览和终端输出。
- 配对信息、会话状态和运行数据保存在本机 Relay 中，不经过第三方。

## 公开仓库内容

这个公开仓库目前包含电脑端需要运行的部分：

| 路径                        | 说明                                                 |
| --------------------------- | ---------------------------------------------------- |
| `packages/codex-relay`      | 核心 Relay 服务端，默认监听 `17878`                  |
| `tools/relay-panel`         | 网页版控制面板                                       |
| `tools/relay-panel-desktop` | Mac / Windows 桌面版控制面板                         |
| `apps/hm_codex`             | HarmonyOS 客户端，目前在本机独立维护，暂不随仓库公开 |

鸿蒙客户端源码暂不开放，仓库主要用于服务端、控制面板和部署协作。

## 快速开始

### 电脑端准备

- Node.js 22.14+ 和 pnpm 11+
- Codex CLI 已安装并登录
- 如果使用桌面端会话，需要 macOS 和官方 Codex Desktop
- 鸿蒙手机已安装本项目客户端

### 克隆并启动

```sh
git clone -b main https://github.com/LayLIiu/codex-relay.git
cd codex-relay
corepack enable
pnpm install
pnpm dev
```

Relay 默认监听 `17878`。启动后终端会显示：

- 配对二维码
- 手机连接地址
- `codex-relay://pair...` 配对链接
- 一个 `XXXX-XXXX` 配对码

### 手机配对

1. 打开鸿蒙端 App。
2. 扫描电脑端二维码，或粘贴配对链接。
3. 手机显示 `XXXX-XXXX` 配对码后，在电脑端批准：

```sh
pnpm codex-relay:cli approve XXXX-XXXX
```

也可以使用控制面板批准。

## 控制面板

不想看终端日志时，可以使用网页控制面板：

```sh
pnpm panel
```

浏览器打开 `http://127.0.0.1:7800`，可以一键启动/停止 Relay、显示二维码、批准配对和查看日志。

如果不想安装 Node.js 和 pnpm，可以构建 Mac / Windows 桌面版控制面板：

```sh
cd tools/relay-panel-desktop
npm install
npm run build:mac
```

Windows 安装包需要在 Windows 上执行：

```sh
npm run build:win
```

## 网络说明

- 手机和电脑在同一 Wi-Fi 时，使用电脑局域网 IP。
- 跨网络时建议使用 Tailscale。
- 公网部署时设置公网地址，例如 `PUBLIC_URL=http://你的域名:端口 pnpm panel`。
- Windows 防火墙需要放行 `17878/TCP`；桌面版面板内置「修复 Windows 防火墙」按钮。
- 桌面端会话控制只支持 macOS。Windows 上可以运行 Relay 和 CLI 会话。

## 常用命令

| 命令                           | 作用                            |
| ------------------------------ | ------------------------------- |
| `pnpm dev` / `pnpm dev:server` | 启动 Relay 服务端，默认 `17878` |
| `pnpm panel`                   | 启动网页控制面板，默认 `7800`   |
| `pnpm codex-relay:cli`         | 直接运行 Relay CLI              |
| `pnpm test`                    | 运行服务端测试                  |
| `pnpm typecheck`               | 类型检查                        |
| `pnpm lint`                    | oxlint + oxfmt 检查             |

## 环境变量

### Relay

Relay 默认监听 `0.0.0.0:17878`：

| 变量                         | 作用                             | 默认                        |
| ---------------------------- | -------------------------------- | --------------------------- |
| `PORT`                       | Relay 服务端口                   | `17878`                     |
| `HOST`                       | 监听地址                         | `0.0.0.0`                   |
| `CODEX_RELAY_WORKSPACE_PATH` | Codex 使用的工作区路径           | 当前目录                    |
| `CODEX_BIN`                  | Codex CLI 可执行文件路径         | `codex`                     |
| `CODEX_DESKTOP_APP_PATH`     | 官方 Codex/ChatGPT 桌面 App 路径 | `/Applications/ChatGPT.app` |
| `CODEX_DESKTOP_CDP_PORT`     | 本地 CDP 调试端口                | `39252`                     |
| `CODEX_DESKTOP_USE_CDP`      | 设为 `1` 时启用 CDP 路径         | 空                          |

### 控制面板

| 变量         | 作用                  | 默认    |
| ------------ | --------------------- | ------- |
| `PANEL_PORT` | 面板端口              | `7800`  |
| `RELAY_PORT` | 面板管理的 Relay 端口 | `17878` |
| `PUBLIC_URL` | 设置后生成公网配对码  | 空      |

## 架构

```text
鸿蒙手机
    │  配对 / 会话 / 流式输出
    ▼
Relay 服务端
    │  启动并接管本机会话
    ▼
Codex CLI 或 Codex Desktop
```

## 测试

```sh
pnpm test
pnpm typecheck
pnpm lint
```

服务端测试位于 `packages/codex-relay/test`，改动 API、校验、流式或线程状态时建议补充测试。

## License

Codex Relay 采用 Apache License 2.0，见 [LICENSE](./LICENSE)。

项目名称、Logo、图标、截图等品牌资产不在 Apache-2.0 许可范围内，见 [TRADEMARKS.md](./TRADEMARKS.md)。
