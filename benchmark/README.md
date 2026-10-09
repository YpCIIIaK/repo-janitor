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
