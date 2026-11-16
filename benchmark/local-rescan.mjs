#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import { createRun, getRun, listRuns, controlRun, worker, exportRun } from "./local-rescan-manager.mjs"
import { restoreBaseline } from "./local-rescan-restore.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const [command, value] = process.argv.slice(2)
try {
  if (command === "export") console.log(JSON.stringify(await exportRun(root, value), null, 2))
  else if (command === "restore") console.log(JSON.stringify(restoreBaseline(root, value), null, 2))
  else if (command === "worker") {
    const state = await worker(root, value)
    console.log(JSON.stringify(state, null, 2))
    if (["failed", "completed_with_errors", "interrupted"].includes(state.status)) process.exitCode = 1
  } else if (command === "run") {
    const input = value ? JSON.parse(readFileSync(value, "utf8")) : {}
    const id = await createRun(root, input)
    console.log(`Run ${id}; dashboard: /local-rescan`)
    const state = await worker(root, id)
    console.log(JSON.stringify(state, null, 2))
    if (state.status !== "completed") process.exitCode = 1
  } else if (["resume", "retry"].includes(command)) {
    controlRun(root, value, command)
    const state = await worker(root, value)
    console.log(JSON.stringify(state, null, 2))
    if (state.status !== "completed") process.exitCode = 1
  } else if (["pause", "cancel"].includes(command)) controlRun(root, value, command)
  else if (command === "status") console.log(JSON.stringify(value ? getRun(root, value) : listRuns(root), null, 2))
  else console.log("Usage: pnpm local:rescan restore [data-ref] | run [config.json] | status [id] | pause id | resume id | retry id | cancel id | export id\nWeb UI: pnpm local:dashboard")
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
