import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { once } from "node:events"
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout, clearTimeout } from "node:timers"

const preload = new URL("./network-audit.mjs", import.meta.url).href
async function run(args, env) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const timeout = setTimeout(() => child.kill(), 15000)
  try { const [code] = await once(child, "close"); return { code, stdout, stderr } }
  finally { clearTimeout(timeout) }
}
async function serverFor(status, body = "{}") {
  const server = http.createServer((req, res) => { req.resume(); res.writeHead(status); res.end(body) })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}
const quietClient = (exitCode) => `
  import http from 'node:http';
  const req = http.request(process.env.TEST_URL, { agent: false }, res => {
    res.resume(); res.on('end', () => process.exit(${exitCode}));
  });
  req.on('error', () => process.exit(${exitCode})); req.end();
`

for (const status of [503, 429]) {
  test(`a quietly swallowed HTTP ${status} still makes the metadata attempt fail`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
    const { server, url } = await serverFor(status)
    try {
      const result = await run(["--import", preload, "--input-type=module", "-e", quietClient(0)], { TEST_URL: url, BENCH_NETWORK_AUDIT_FILE: audit })
      assert.equal(result.code, 70, result.stderr)
      const data = JSON.parse(readFileSync(audit, "utf8"))
      assert.equal(data.transportOK, false)
      assert.equal(data.statuses[status], 1)
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const exitCode of [0, 2]) {
  test(`successful metadata transport preserves CLI exit code ${exitCode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
    const { server, url } = await serverFor(200)
    try {
      const result = await run(["--import", preload, "--input-type=module", "-e", quietClient(exitCode)], { TEST_URL: url, BENCH_NETWORK_AUDIT_FILE: audit })
      assert.equal(result.code, exitCode, result.stderr)
      assert.equal(JSON.parse(readFileSync(audit, "utf8")).transportOK, true)
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

test("an offline-only metadata attempt reports zero network requests explicitly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
  try {
    const result = await run(["--import", preload, "-e", "process.exit(0)"], { BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 0)
    const data = JSON.parse(readFileSync(audit, "utf8"))
    assert.equal(data.requests, 0)
    assert.equal(data.queriedPackages, 0)
    assert.equal(data.transportOK, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("an absent registry resource remains an explicit HTTP 404, not a transport outage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
  const { server, url } = await serverFor(404)
  try {
    const result = await run(["--import", preload, "--input-type=module", "-e", quietClient(0)], { TEST_URL: url, BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 0)
    const data = JSON.parse(readFileSync(audit, "utf8"))
    assert.equal(data.statuses[404], 1)
    assert.equal(data.transportOK, true)
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
})

test("OSV package-query counts are recorded without retaining package names or request bodies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
  const { server, url } = await serverFor(200)
  try {
    const code = `
      import http from 'node:http';
      const req = http.request(process.env.TEST_URL + '/v1/querybatch', {method:'POST', agent:false}, res => {
        res.resume(); res.on('end', () => process.exit(0));
      });
      req.end(JSON.stringify({queries:[{package:{name:'private-fixture-name'}},{}]}));
    `
    const result = await run(["--import", preload, "--input-type=module", "-e", code], { TEST_URL: url, BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 0, result.stderr)
    const raw = readFileSync(audit, "utf8"), data = JSON.parse(raw)
    assert.equal(data.queryBatches, 1)
    assert.equal(data.queriedPackages, 2)
    assert.doesNotMatch(raw, /private-fixture-name/)
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
})

test("the existing response-size policy is disclosed separately from transport failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json")
  const { server, url } = await serverFor(200)
  try {
    const code = `
      import http from 'node:http';
      const req = http.request(process.env.TEST_URL, {agent:false}, res => {
        res.on('data', () => res.destroy(new Error('Response too large')));
        res.on('error', () => setImmediate(() => process.exit(0)));
      }); req.end();
    `
    const result = await run(["--import", preload, "--input-type=module", "-e", code], { TEST_URL: url, BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 0, result.stderr)
    const data = JSON.parse(readFileSync(audit, "utf8"))
    assert.equal(data.policyLimitedResponses, 1)
    assert.equal(data.transportOK, true)
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }) }
})

test("a caught DNS failure is not recorded as a successful check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json"), stub = join(dir, "dns.cjs")
  try {
    writeFileSync(stub, "require('node:dns/promises').lookup = async () => { throw Object.assign(new Error('temporary DNS failure'), { code: 'EAI_AGAIN' }) }\n")
    const code = "import {lookup} from 'node:dns/promises'; lookup('api.osv.dev').catch(() => process.exit(0))"
    const result = await run(["--require", stub, "--import", preload, "--input-type=module", "-e", code], { BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 70, result.stderr)
    assert.equal(JSON.parse(readFileSync(audit, "utf8")).dnsFailures, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("a metadata preflight that resolves a host but never starts its request is incomplete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-network-")), audit = join(dir, "audit.json"), stub = join(dir, "dns.cjs")
  try {
    writeFileSync(stub, "require('node:dns/promises').lookup = async () => [{address:'8.8.8.8', family:4}]\n")
    const code = "import {lookup} from 'node:dns/promises'; lookup('api.osv.dev').then(() => process.exit(0))"
    const result = await run(["--require", stub, "--import", preload, "--input-type=module", "-e", code], { BENCH_NETWORK_AUDIT_FILE: audit })
    assert.equal(result.code, 70, result.stderr)
    const data = JSON.parse(readFileSync(audit, "utf8"))
    assert.equal(data.unstartedRequests, 1)
    assert.equal(data.transportOK, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the OSV runner refuses to cache an empty report after HTTP 503", async () => {
  const root = mkdtempSync(join(tmpdir(), "bench-osv-")), bench = join(root, "benchmark"), repo = join(root, "fixture")
  const { server, url } = await serverFor(503)
  try {
    mkdirSync(bench)
    mkdirSync(join(bench, ".results"))
    mkdirSync(repo)
    mkdirSync(join(root, "packages/cli/dist"), { recursive: true })
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    git("init", "--quiet")
    writeFileSync(join(repo, "package.json"), '{"name":"fixture","version":"1.0.0"}')
    git("add", ".")
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture")
    const sha = git("rev-parse", "HEAD").trim()
    writeFileSync(join(bench, "corpus.json"), JSON.stringify([{ name: "fixture", url: repo, sha }]))
    for (const f of ["osv.mjs", "network-audit.mjs"]) copyFileSync(new URL(`./${f}`, import.meta.url), join(bench, f))
    writeFileSync(join(root, "packages/cli/dist/index.js"), `
      const fs = require('node:fs'), http = require('node:http');
      const output = process.argv[process.argv.indexOf('--output') + 1];
      const req = http.request(process.env.TEST_URL, {agent: false}, res => {
        res.resume(); res.on('end', () => {
          fs.writeFileSync(output, JSON.stringify({issues: [], diagnostics: {failedScanners: []}}));
          process.exit(0);
        });
      }); req.end();
    `)
    const result = await run([join(bench, "osv.mjs")], { TEST_URL: url, BENCH_NETWORK_RETRIES: "0", BENCH_JOBS: "1" })
    assert.ok(!existsSync(join(bench, ".results/fixture.osv.json")), "HTTP errors must not produce cached clean reports")
    assert.equal(result.code, 1, result.stderr)
    assert.match(result.stderr, /network incomplete/)
    assert.doesNotMatch(result.stdout, /all repos checked/)
  } finally { server.close(); rmSync(root, { recursive: true, force: true }) }
})
