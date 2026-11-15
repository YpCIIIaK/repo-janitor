/** Observe metadata requests without changing the CLI's transport or scanner rules. */
import http from "node:http"
import https from "node:https"
import dns from "node:dns/promises"
import { syncBuiltinESMExports } from "node:module"
import { writeFileSync } from "node:fs"

const auditPath = process.env.BENCH_NETWORK_AUDIT_FILE
if (auditPath) {
  const state = {
    version: 2, requests: 0, responses: 0, failedRequests: 0, dnsFailures: 0,
    queryBatches: 0, queriedPackages: 0, policyLimitedResponses: 0,
    statuses: {}, hosts: {}, dnsHosts: {}, policyLimitedHosts: {}, unstartedRequests: 0, failureSamples: [],
  }
  const publicHost = (host) => ["api.osv.dev", "registry.npmjs.org"].includes(host) ? host : "other"
  const requests = []
  const sample = (entry) => { if (state.failureSamples.length < 12) state.failureSamples.push(entry) }
  const lookup = dns.lookup
  dns.lookup = async function (...args) {
    const host = publicHost(String(args[0]))
    state.dnsHosts[host] = (state.dnsHosts[host] ?? 0) + 1
    try { return await Reflect.apply(lookup, this, args) }
    catch (error) {
      state.dnsFailures++
      sample({ kind: "dns", host: publicHost(String(args[0])), code: error?.code ?? "UNKNOWN" })
      throw error
    }
  }
  for (const transport of [http, https]) {
    const request = transport.request
    transport.request = function (...args) {
      const record = { host: "other", httpFailure: null, transportFailure: null, policyLimited: false, allowedPolicyLimit: false }
      requests.push(record)
      state.requests++
      let req
      try { req = Reflect.apply(request, this, args) }
      catch (error) {
        record.transportFailure = { kind: "request", code: error?.code ?? "UNKNOWN" }
        throw error
      }
      let hostname = "other"
      try { hostname = publicHost(new URL("http://" + req.getHeader("host")).hostname) } catch { /* diagnostic only */ }
      state.hosts[hostname] = (state.hosts[hostname] ?? 0) + 1
      record.host = hostname
      const fail = (kind, detail) => {
        record.transportFailure ??= { kind, ...detail }
      }
      const policyLimit = (error) => {
        if (error?.message !== "Response too large") return false
        if (!record.policyLimited) {
          state.policyLimitedResponses++
          state.policyLimitedHosts[record.host] = (state.policyLimitedHosts[record.host] ?? 0) + 1
        }
        record.policyLimited = true
        // A bounded npm license lookup may be unknown. Truncating OSV queries
        // or advisory details must never turn into an apparently clean check.
        record.allowedPolicyLimit = record.host === "registry.npmjs.org"
        if (!record.allowedPolicyLimit) fail("policy", { code: "RESPONSE_TOO_LARGE" })
        return true
      }
      req.on("error", (error) => { if (!policyLimit(error)) fail("request", { code: error?.code ?? "UNKNOWN" }) })
      req.on("response", (res) => {
        const status = res.statusCode ?? 0
        state.responses++
        state.statuses[status] = (state.statuses[status] ?? 0) + 1
        if (status >= 500 || [403, 408, 425, 429].includes(status)) record.httpFailure = status
        res.on("error", (error) => {
          // The stable CLI deliberately caps response sizes. Expose that limit,
          // rather than treating a policy-limited license lookup as a network outage.
          if (!policyLimit(error)) fail("response", { code: error?.code ?? "UNKNOWN" })
        })
      })
      const end = req.end
      req.end = function (...endArgs) {
        if (req.method === "POST" && req.path?.split("?")[0] === "/v1/querybatch") {
          try {
            const body = JSON.parse(String(endArgs[0] ?? ""))
            if (Array.isArray(body.queries)) {
              state.queryBatches++
              state.queriedPackages += body.queries.length
            }
          } catch { /* request counting must not change request handling */ }
        }
        return Reflect.apply(end, this, endArgs)
      }
      return req
    }
  }
  syncBuiltinESMExports()
  process.on("exit", () => {
    const failed = requests.filter((r) => r.httpFailure || (!r.allowedPolicyLimit && r.transportFailure))
    state.failedRequests = failed.length
    for (const r of failed) sample(r.httpFailure
      ? { kind: "http", host: r.host, status: r.httpFailure }
      : { host: r.host, ...r.transportFailure })
    // safeRequest resolves these two hosts before creating an HTTP request.
    // A guard/preflight abort must not become an apparently successful empty result.
    for (const host of ["api.osv.dev", "registry.npmjs.org"]) {
      const missing = Math.max(0, (state.dnsHosts[host] ?? 0) - (state.hosts[host] ?? 0))
      if (missing) {
        state.unstartedRequests += missing
        sample({ kind: "request_not_started", host, count: missing })
      }
    }
    const transportOK = state.failedRequests === 0 && state.dnsFailures === 0 && state.unstartedRequests === 0
    writeFileSync(auditPath, JSON.stringify({ ...state, transportOK }))
    if (!transportOK) {
      process.stderr.write("benchmark: metadata network incomplete; result must not be cached\n")
      process.exitCode = 70
    }
  })
}
