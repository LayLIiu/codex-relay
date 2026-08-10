# Codex Relay 控制面板

一个本地网页面板，用来管理本机 Codex Relay 服务：

- **一键启动** 17878 端口的 Relay 服务（等价于 `PORT=17878 pnpm dev`）
- **显示配对二维码**（从服务端 `server-state.json` 读取配对链接，网页生成二维码）
- **批准设备配对**（输入鸿蒙端显示的 `XXXX-XXXX` 配对码，一键批准，等价于
  `npx codex-relay@latest approve XXXX-XXXX`）
- **查看服务日志**、停止服务

## 使用

```bash
pnpm panel
```

然后浏览器打开 **http://127.0.0.1:7800** 即可。

## 说明

- 面板默认监听 `7800` 端口，可通过 `PANEL_PORT` 环境变量修改。
- 管理的 Relay 端口默认 `17878`，可通过 `RELAY_PORT` 修改。
- 配对二维码与配对码来自正在运行的 Relay 服务：
  - 面板自己启动服务时，会从服务输出解析配对链接；
  - 服务由其他方式启动时，会从 `~/Library/Application Support/codex-relay/server-state.json`
    读取配对链接（该文件由 Relay 服务自动更新）。
- 「批准」直接调用服务端的 `POST /v1/pair/approve` 接口，审批密钥从
  `approval-secret` 文件（或 `CODEX_RELAY_APPROVAL_SECRET` 环境变量）读取。

## 二维码本地化

二维码使用仓库内置的 `public/qrcode.min.js` 在浏览器本地生成，**完全离线可用**，
不依赖任何 CDN。

默认展示本地/局域网配对码；设置 `PUBLIC_URL` 环境变量（如
`PUBLIC_URL=http://host:8789 pnpm panel`）后，面板会额外生成并展示公网配对码，
同时显示「局域网备选」地址。
