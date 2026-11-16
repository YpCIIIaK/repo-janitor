import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const port = process.argv[2] ?? "3100"
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Port must be 1024..65535")
console.log(`Local rescan dashboard: http://127.0.0.1:${port}/local-rescan`)
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--hostname", "127.0.0.1", "--port", port], {
  cwd: root, stdio: "inherit", env: { ...process.env, REPO_JANITOR_LOCAL_RESCAN: "1", PUBLIC_ORIGIN: `http://127.0.0.1:${port}` },
})
child.on("error", error => { console.error(error.message); process.exitCode = 1 })
child.on("exit", code => { process.exitCode = code ?? 1 })
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
