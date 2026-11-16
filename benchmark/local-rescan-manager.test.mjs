import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRun, worker, getRun, controlRun, prepareWorkspace, runPath, taskDetail, taskReport, pinnedTargets, exportRun } from "./local-rescan-manager.mjs"

const sha = "a".repeat(40)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let n = 0; n < 100; n++) { if (check()) return; await delay(50) }
  throw new Error("Timed out waiting for fixture")
}
function fixture(names) {
  const root = mkdtempSync(join(tmpdir(), "janitor-local-rescan-"))
  for (const directory of ["benchmark/.results", "packages/core/src", "packages/core/dist", "packages/cli/src", "packages/cli/dist"]) mkdirSync(join(root, directory), { recursive: true })
  const repos = names.map(name => ({ name, url: `https://github.com/fixture/${name}`, sha }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "benchmark/corpus.json"), JSON.stringify(repos))
  for (const pkg of ["core", "cli"]) {
    writeFileSync(join(root, `packages/${pkg}/src/index.ts`), "// frozen source")
    writeFileSync(join(root, `packages/${pkg}/dist/index.js`), "export {}")
    writeFileSync(join(root, `packages/${pkg}/package.json`), '{"type":"module"}')
  }
  writeFileSync(join(root, "benchmark/fingerprint.mjs"), `export const newestSource=()=>0;export const scanFingerprint=()=>"frozen";export const scannerFingerprints=()=>({base:"base",scanners:{demo:"v2",other:"v2"}});export const scannerModules=()=>({demo:"fixture",other:"fixture"});`)
  writeFileSync(join(root, "benchmark/run.mjs"), `
    import fs from 'node:fs';import {spawn} from 'node:child_process';
    const name=process.argv[2],repo=JSON.parse(fs.readFileSync('benchmark/corpus.json')).find(r=>r.name===name);
    fs.appendFileSync('events.log',JSON.stringify({name,event:'start',time:Date.now()})+'\\n');
    if(name==='missing')process.exit(0);
    if(name==='fail'&&!fs.existsSync('retry-ok'))process.exit(1);
    if(name==='hang'){
      const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      fs.writeFileSync('grandchild.pid',String(child.pid));setInterval(()=>{},1000);await new Promise(()=>{});
    }
    await new Promise(r=>setTimeout(r,300));
    fs.writeFileSync('benchmark/.results/'+name+'.json',JSON.stringify({sha:repo.sha,base:'base',scanners:{demo:'v2',other:'v2'},findings:[],...(process.env.BENCH_FORCE_SCANNERS?{rerun:process.env.BENCH_FORCE_SCANNERS.split(',')}:{})}));
    fs.writeFileSync('benchmark/.results/'+name+'.report.json',JSON.stringify({issues:[],diagnostics:{failedScanners:[]}}));
    fs.appendFileSync('events.log',JSON.stringify({name,event:'finish',time:Date.now()})+'\\n');
  `)
  for (const repo of repos) {
    writeFileSync(join(root, `benchmark/.results/${repo.name}.json`), JSON.stringify({ sha, base: "old", scanners: { demo: "old", other: "old" }, findings: [] }))
    writeFileSync(join(root, `benchmark/.results/${repo.name}.report.json`), '{"issues":[{"id":"published"}]}')
  }
  return root
}

test("four default workers overlap, preserve baseline bytes, and freeze the scanner", async t => {
  const root = fixture(["one", "two", "three", "four"])
  t.after(() => rmSync(root, { recursive: true }))
  const original = readFileSync(join(root, "benchmark/.results/one.report.json"), "utf8")
  const id = await createRun(root, { minFreeGiB: 0 })
  const workspace = await prepareWorkspace(root, id)
  writeFileSync(join(root, "benchmark/run.mjs"), 'throw new Error("Changed after freezing")')
  const state = await worker(root, id)
  assert.equal(state.status, "completed"); assert.equal(state.done, 4); assert.equal(state.config.jobs, 4)
  assert.equal(readFileSync(join(root, "benchmark/.results/one.report.json"), "utf8"), original)
  assert.deepEqual(taskReport(root, id, "one").issues, [])
  const events = readFileSync(join(workspace, "events.log"), "utf8").trim().split("\n").map(JSON.parse)
  assert.equal(events.slice(0, 4).every(row => row.event === "start"), true)
  assert.equal(existsSync(join(root, "benchmark/.local-rescans/active.lock")), false)
  const exported = await exportRun(root, id)
  assert.equal(exported.records, 4)
  assert.match(exported.sha256, /^[a-f0-9]{64}$/)
  assert.equal(existsSync(exported.archive), true)
})

test("pause drains running tasks; resume preserves completed work", async t => {
  const root = fixture(["one", "two", "three"])
  t.after(() => rmSync(root, { recursive: true }))
  const id = await createRun(root, { jobs: 1, minFreeGiB: 0 })
  const running = worker(root, id)
  await until(() => getRun(root, id).active?.length === 1)
  controlRun(root, id, "pause")
  const paused = await running
  assert.equal(paused.status, "paused"); assert.equal(paused.done, 1); assert.equal(paused.pending, 2)
  await assert.rejects(exportRun(root, id), /fully completed/)
  controlRun(root, id, "resume")
  const resumed = await worker(root, id)
  assert.equal(resumed.status, "completed"); assert.equal(resumed.done, 3)
  assert.equal(taskDetail(root, id, "one").task.attempts, 1)
})

test("failed tasks stay errors until explicitly retried; missing output is not success", async t => {
  const root = fixture(["one", "fail", "missing"])
  t.after(() => rmSync(root, { recursive: true }))
  const id = await createRun(root, { jobs: 2, minFreeGiB: 0 })
  const first = await worker(root, id)
  assert.equal(first.status, "completed_with_errors"); assert.equal(first.failed, 2)
  assert.match(taskDetail(root, id, "missing").task.error, /stale scanner fingerprints/)
  writeFileSync(join(runPath(root, id), "workspace/retry-ok"), "ok")
  controlRun(root, id, "retry")
  const retried = await worker(root, id)
  assert.equal(retried.done, 2); assert.equal(retried.failed, 1)
  assert.equal(taskDetail(root, id, "one").task.attempts, 1)
  assert.equal(taskDetail(root, id, "fail").task.attempts, 2)
})

test("cancel terminates task process groups and does not mark incomplete output successful", async t => {
  const root = fixture(["hang", "two"])
  t.after(() => rmSync(root, { recursive: true }))
  const id = await createRun(root, { jobs: 1, minFreeGiB: 0 })
  const running = worker(root, id)
  const marker = join(runPath(root, id), "workspace/grandchild.pid")
  await until(() => existsSync(marker)); await delay(150)
  const grandchild = Number(readFileSync(marker, "utf8"))
  controlRun(root, id, "cancel")
  const result = await running
  assert.equal(result.status, "cancelled"); assert.equal(result.done, 0)
  assert.equal(taskDetail(root, id, "hang").task.status, "cancelled")
  await until(() => {
    try {
      process.kill(grandchild, 0)
      // Some container PID 1 implementations retain dead grandchildren as zombies.
      return process.platform === "linux" && readFileSync(`/proc/${grandchild}/stat`, "utf8").split(") ")[1].startsWith("Z")
    } catch { return true }
  })
})

test("invalid targets, unknown scanners and path traversal never become runnable plans", async t => {
  const root = fixture(["one"])
  t.after(() => rmSync(root, { recursive: true }))
  assert.throws(() => pinnedTargets([{ name: "../escape", url: "https://github.com/a/b", sha }]), /Invalid/)
  assert.throws(() => pinnedTargets([{ name: "one", url: "http://127.0.0.1/private", sha }]), /GitHub/)
  assert.throws(() => pinnedTargets([{ name: "one", url: "https://github.com/a/b", sha: "main" }]), /SHA/)
  await assert.rejects(createRun(root, { jobs: 0 }), /Workers/)
  await assert.rejects(createRun(root, { mode: "scanners", scanners: ["typo"] }), /Unknown scanner/)
  await assert.rejects(createRun(root, { names: ["unknown"] }), /unknown repositories/)
  assert.throws(() => runPath(root, "../../outside"), /Invalid/)
})

test("a second worker cannot take the lease of an active run", async t => {
  const root = fixture(["one"])
  t.after(() => rmSync(root, { recursive: true }))
  const first = await createRun(root, { minFreeGiB: 0 }), second = await createRun(root, { minFreeGiB: 0 })
  const running = worker(root, first)
  await until(() => getRun(root, first).active?.length === 1)
  await assert.rejects(worker(root, second), /Another local rescan/)
  assert.equal(getRun(root, second).status, "failed")
  assert.equal((await running).status, "completed")
})

test("an unsuccessful metadata stage never turns an offline result into full success", async t => {
  const root = fixture(["one"])
  t.after(() => rmSync(root, { recursive: true }))
  // An exited-zero collector without its audited artifact must fail validation.
  writeFileSync(join(root, "benchmark/osv.mjs"), "process.exit(0)")
  const id = await createRun(root, { refreshMetadata: true, minFreeGiB: 0 })
  const result = await worker(root, id)
  assert.equal(result.status, "completed_with_errors")
  assert.equal(result.done, 0)
  assert.match(taskDetail(root, id, "one").task.error, /metadata audit/)
})

test("selective runs do not certify untouched scanners; past local results can seed another run", async t => {
  const root = fixture(["one"])
  t.after(() => rmSync(root, { recursive: true }))
  const id = await createRun(root, { mode: "scanners", scanners: ["demo"], minFreeGiB: 0 })
  assert.equal((await worker(root, id)).status, "completed")
  const relative = "benchmark/.results/one.json"
  const firstResult = JSON.parse(readFileSync(join(runPath(root, id), "workspace", relative), "utf8"))
  assert.equal(firstResult.scanners.demo, "v2")
  assert.equal(firstResult.scanners.other, "old")
  assert.equal(firstResult.base, "old")
  const second = await createRun(root, { baselineRun: id, minFreeGiB: 0 })
  const workspace = await prepareWorkspace(root, second)
  assert.deepEqual(JSON.parse(readFileSync(join(workspace, relative), "utf8")), firstResult)
  assert.equal(JSON.parse(readFileSync(join(root, relative), "utf8")).scanners.demo, "old")
})
