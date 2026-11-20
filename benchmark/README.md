# Scanner benchmark

Measures how many findings are **real** (precision), per scanner and per rule,
on 20 public repositories in JS/TS, Python, Go, Rust, Ruby and PHP.

```sh
pnpm run build:cli
pnpm bench:run             # clone (cached in .cache/) and scan each repo offline
pnpm bench:score           # precision table → REPORT.md
pnpm bench:score --check   # fail if a scanner fell below baseline.json
pnpm bench:sample          # unlabelled findings to review, with source context
node benchmark/label.mjs   # record verdicts: "<repo> <tp|fp> <finding id>" per line
pnpm bench:score --update  # accept current numbers as the new baseline
```

## Reproducibility

- Every repo is pinned to a commit in `corpus.json`.
- Scans run with `REPO_ANTI_ROT_OFFLINE=1`: no OSV, registry or link checks,
  because their answers change over time. Those scanners are not measured here.
- Ages are computed against today, so a few time-based findings (EOL dates,
  TODO age) can appear later. They show up as *unlabelled*, never as failures.

## How findings were labelled

A sample of up to 3 findings per rule per repo, chosen by a stable hash of the id.

- **tp** — the claim is true *and* a maintainer of that project would accept
  it as worth acting on.
- **fp** — the claim is false, or it is technically true but wrong for the
  context: a library's public API reported as "unused", a test fixture's
  private key, `print()` inside a docstring, `println!("cargo:…")` in `build.rs`,
  a workflow whose every job sets `permissions:`, a deliberate
  `package-lock=false`, standard env vars (`NO_PROXY`, `SSL_CERT_FILE`) asked
  to go into `.env.example`, bus-factor on tests / fixtures / configs.

Labels are judgement calls; disagreeing with one is a reason to change it in
`labels/<repo>.json`, with the reason in the commit message.

"Lost TP" counts confirmed findings that no longer appear — a recall regression.

## JavaScript ReDoS acceptance

Report the static recall measured on pinned advisory pairs. There is no target
of complete coverage. Count a hit only when a complexity finding meets the
existing recall criteria. Track two kinds of unresolved evidence separately:
`js-dynamic-regexp` when the pattern or flags cannot be resolved statically and
`js-regexp-analysis-budget` when the static detector reaches its step or time
limit. These low-confidence findings identify code for follow-up review and do
not contribute to confirmed recall. A case without either finding is a
coverage gap. Keep it in the denominator and record the limitation when known.

### Advisory review (2026-11-20)

The static sample contains seven JavaScript cases explicitly tagged CWE-1333.
Two qualify as hits. The five remaining cases are deferred:

| Advisory | Static result | Follow-up |
| --- | --- | --- |
| GHSA-3ppc-4f35-3m26 (minimatch) | miss | Dynamic pattern findings in the changed glob compiler files. Resolving their runtime patterns is outside this scanner's current analysis. |
| GHSA-6g33-8w2q-4hxv (robots-txt-guard) | miss | Dynamic pattern findings in the changed pattern generator. |
| GHSA-c2c7-rcm5-vvqj (picomatch) | near | Dynamic pattern finding in the changed glob parser. |
| GHSA-fp36-299x-pwmw (devcert) | miss | The local validation pattern reached the static analysis budget in the scan. The fix replaces local validation with a dependency. |
| GHSA-xmc8-cjfr-phx3 (Highcharts) | near | Findings in the changed renderer do not isolate the expressions removed by the fix. A dynamic pattern finding in the same file does not establish the cause. |

These results describe the current analyzer and budget. No claim is made that
the remaining cases cannot be detected by another static method.
