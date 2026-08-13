import { chmodSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const vendorNodeDir = resolve(projectRoot, "vendor", "node-runtime");
const cacheDir = resolve(projectRoot, ".cache", "node-runtime");
const version = process.env.NODE_RUNTIME_VERSION ?? "22.14.0";
const platform = process.env.NODE_RUNTIME_PLATFORM ?? process.platform;
const arch = process.env.NODE_RUNTIME_ARCH ?? process.arch;
const isWindows = platform === "win32";

if (platform !== "darwin" && platform !== "win32") {
  throw new Error(`Unsupported Node runtime platform: ${platform}`);
}
if (arch !== "arm64" && arch !== "x64") {
  throw new Error(`Unsupported Node runtime arch: ${arch}`);
}
if (isWindows && arch !== "x64") {
  throw new Error("Windows Node runtime currently supports x64 only.");
}
if (platform === "darwin" && arch !== "arm64" && arch !== "x64") {
  throw new Error(`Unsupported Node runtime arch: ${arch}`);
}

const archiveBase = isWindows
  ? `node-v${version}-win-x64`
  : `node-v${version}-${platform}-${arch}`;
const archiveName = `${archiveBase}${isWindows ? ".zip" : ".tar.gz"}`;
const archivePath = join(cacheDir, archiveName);
const extractedDir = join(cacheDir, archiveBase);
const downloadUrl = `https://nodejs.org/dist/v${version}/${archiveName}`;

mkdirSync(cacheDir, { recursive: true });
rmSync(vendorNodeDir, { recursive: true, force: true });

if (process.env.NODE_RUNTIME_SKIP_DOWNLOAD !== "1") {
  console.log(`下载 Node.js ${version} ${platform}-${arch} ...`);
  execFileSync("curl", ["-L", downloadUrl, "-o", archivePath], {
    stdio: "inherit",
    timeout: 5 * 60 * 1000,
  });
}

rmSync(extractedDir, { recursive: true, force: true });
mkdirSync(extractedDir, { recursive: true });
if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractedDir}' -Force`,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync(
    archiveName.endsWith(".zip") ? "unzip" : "tar",
    archiveName.endsWith(".zip")
      ? ["-q", archivePath, "-d", extractedDir]
      : ["-xzf", archivePath, "-C", extractedDir],
    { stdio: "inherit" },
  );
}

mkdirSync(vendorNodeDir, { recursive: true });
if (isWindows) {
  cpSync(join(extractedDir, archiveBase, "node.exe"), join(vendorNodeDir, "node.exe"));
} else {
  const binDir = join(vendorNodeDir, "bin");
  mkdirSync(binDir, { recursive: true });
  cpSync(join(extractedDir, archiveBase, "bin", "node"), join(binDir, "node"));
  chmodSync(join(binDir, "node"), 0o755);
}

console.log(`Node.js 运行时已就绪：${vendorNodeDir}`);
