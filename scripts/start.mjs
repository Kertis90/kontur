import { access, cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const standalone = path.join(root, ".next/standalone");
const server = path.join(standalone, "server.js");

try {
  await access(server);
} catch {
  console.error("Production-сборка не найдена. Сначала выполните npm run build.");
  process.exit(1);
}

await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
  force: true,
});
await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), {
  recursive: true,
  force: true,
});

const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  env: {
    ...process.env,
    HOSTNAME: process.env.KONTUR_HOST || "0.0.0.0",
    PORT: process.env.KONTUR_PORT || process.env.PORT || "3000",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Не удалось запустить production-сервер: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 0 : (code ?? 1);
});
