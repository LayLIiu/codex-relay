# Codex Relay 公网部署手册（干净版）

> 目标：用公网 `47.102.141.228:8789` 跑干净版 Codex Relay（`/Users/liujie/Downloads/codex-relay-main-2`）

## ⚠️ 端口映射关系（重要）

- **本地监听**：`17878`（服务端 `PORT=17878`）
- **frp 公网映射**：`remotePort = 8789`（见 `~/.codex-relay/frpc.toml`）
- **公网访问/配对 URL**：`http://47.102.141.228:8789`

所以 `CODEX_RELAY_PUBLIC_URL` 必须用 **8789**，不是 17878。
之前二维码 primary 写成 17878，App 连不上公网才退到局域网。

## 0. 现状（已完成）

- ✅ 干净版依赖已装、typecheck 全绿、测试 290 全过
- ✅ `codex-relay` 包已构建（`dist/` 存在）
- ✅ `apps/hm_codex`（HarmonyOS）已拷入并保留 git 历史
- ✅ 公网配对 `CODEX_RELAY_PUBLIC_URL` 已移植（`packages/codex-relay/src/pairing-url-candidates.ts`）
- ✅ 服务端默认监听 `0.0.0.0`，公网可直连

## 1. 本地直接启动（最简单）

```bash
cd /Users/liujie/Downloads/codex-relay-main-2
PORT=17878 HOST=0.0.0.0 CODEX_RELAY_PUBLIC_URL=http://47.102.141.228:8789 pnpm dev
```

或用现成脚本：

```bash
chmod +x /Users/liujie/Downloads/codex-relay-main/deploy-public/start-public.sh
/Users/liujie/Downloads/codex-relay-main/deploy-public/start-public.sh
```

健康检查：

```bash
curl http://127.0.0.1:17878/version
# 应返回包含 "service":"codex-relay-server" 的 JSON
```

## 2. 部署到云服务器（47.102.141.228）

如果你把服务端跑在公网那台服务器上：

### 2.1 上传代码

把 `codex-relay-main-2` 完整传到服务器（rsync 示例）：

```bash
rsync -av --exclude=node_modules --exclude=.git /Users/liujie/Downloads/codex-relay-main-2/ root@47.102.141.228:/opt/codex-relay/
```

### 2.2 服务器上安装并构建

```bash
ssh root@47.102.141.228
cd /opt/codex-relay
corepack enable --install-directory ~/.local/bin   # 确保 pnpm 可用
pnpm install
pnpm --filter codex-relay build
```

### 2.3 开放端口

阿里云/腾讯云控制台 → 安全组 → 放行 **TCP 17878**（来源 `0.0.0.0/0`）。

如果服务器有防火墙：

```bash
firewall-cmd --permanent --add-port=17878/tcp && firewall-cmd --reload
# 或 ufw allow 17878/tcp
```

### 2.4 启动（建议用 nohup 或 systemd 常驻）

```bash
cd /opt/codex-relay
nohup env PORT=17878 HOST=0.0.0.0 CODEX_RELAY_PUBLIC_URL=http://47.102.141.228:8789 \
  node packages/codex-relay/dist/cli.js > /opt/codex-relay/relay.log 2>&1 &
```

健康检查（服务器本机 + 外网各一次）：

```bash
curl http://127.0.0.1:17878/version
curl http://47.102.141.228:8789/version   # 外网能通 = 公网 OK
```

## 3. 手机 App 连接

### 方式 A：扫码配对（推荐）

启动服务端后终端会打印配对二维码，App 里扫码即可。二维码已包含公网 URL
`http://47.102.141.228:8789`，手机用流量/任意网络都能连。

### 方式 B：手动指定服务器

如需 App 默认连公网，在 `apps/mobile` 建 `.env`：

```bash
echo 'EXPO_PUBLIC_CODEX_RELAY_SERVER_URL=http://47.102.141.228:8789' > apps/mobile/.env
```

然后重新构建 App。

## 4. 常用命令

```bash
# 开发
pnpm dev
# 生产构建
pnpm --filter codex-relay build
# 生产运行
PORT=17878 node packages/codex-relay/dist/cli.js
# 类型检查
pnpm typecheck
# 服务端测试
pnpm --filter codex-relay test
# 构建 iOS dev client
cd apps/mobile && pnpm ios
```

## 5. 注意事项

- 首次切到干净版要**重新扫码配对**（服务器密钥不同，旧 App 会话失效）
- 旧对话历史由 Codex（rollout）管理：服务端跑在同一机器/同一工作目录时历史仍在
- 干净版没有旧版的“续聊 worktree / 历史合并”自研逻辑，续聊走上游原生方式，这是稳定来源
- `CODEX_RELAY_PUBLIC_URL` 若之后有域名，改成 `https://你的域名:8789` 即可，代码不用动
