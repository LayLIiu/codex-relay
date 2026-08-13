import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const sourceServer = resolve(root, "tools", "relay-panel", "server.mjs");
const sourcePublic = resolve(root, "tools", "relay-panel", "public");
const relayPackage = resolve(root, "packages", "codex-relay");
const vendor = resolve(import.meta.dirname, "..", "vendor");
const targetPlatform = process.env.DESKTOP_PANEL_TARGET_PLATFORM ?? process.platform;
const targetArch = process.env.DESKTOP_PANEL_TARGET_ARCH ?? process.arch;

await rm(vendor, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });
await cp(sourceServer, resolve(vendor, "server.mjs"));
await cp(sourcePublic, resolve(vendor, "public"), { recursive: true });

// 复制 Relay 服务器构建产物与清单，然后安装自包含的运行时依赖
await mkdir(resolve(vendor, "relay-server"), { recursive: true });
await cp(resolve(relayPackage, "dist"), resolve(vendor, "relay-server", "dist"), { recursive: true });
await cp(resolve(relayPackage, "package.json"), resolve(vendor, "relay-server", "package.json"));

console.log(`正在安装 Relay 服务器运行时依赖（自包含 ${targetPlatform}-${targetArch}）...`);
const npmInstallArgs = [
  "install",
  "--omit=dev",
  "--no-audit",
  "--no-fund",
  "--registry=https://registry.npmmirror.com",
];
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  npmInstallArgs.push("--os", targetPlatform, "--cpu", targetArch, "--force");
}
execFileSync(
  "npm",
  npmInstallArgs,
  {
    cwd: resolve(vendor, "relay-server"),
    stdio: "inherit",
  },
);

console.log("准备自包含 Node.js 运行时...");
execFileSync(
  process.env.npm_node_execpath || process.execPath,
  [resolve(import.meta.dirname, "fetch-node-runtime.mjs")],
  {
    env: {
      ...process.env,
      NODE_RUNTIME_PLATFORM: targetPlatform,
      NODE_RUNTIME_ARCH: targetArch,
    },
    stdio: "inherit",
  },
);

console.log("面板 + Relay 服务器已就绪：vendor/");
