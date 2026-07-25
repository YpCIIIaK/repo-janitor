# repo-anti-rot

A repository **health & decay monitor**, on the command line. It scans a codebase
for the kinds of rot that accumulate silently — committed secrets (working tree
**and** git history), vulnerable & abandoned dependencies, undocumented env vars,
dead & commented-out code, stale branches, aging TODOs, disabled tests, Dockerfile
issues and binary bloat — then scores it **A–F** and reports it as terminal output,
JSON, Markdown or SARIF.

No API key is required. Registry-backed checks (OSV vulnerabilities, npm/PyPI/…
freshness) degrade to a no-op offline instead of failing the scan.

## Install

```bash
# one-off, no install
npx repo-anti-rot scan --path .

# or install globally
npm i -g repo-anti-rot
repo-anti-rot scan --path .
```

Requires **Node.js 20+** and **git** on your `PATH`.

## Usage

```bash
# scan the current checkout, human-readable output
repo-anti-rot scan --path . --format terminal

# write a JSON report
repo-anti-rot scan --path . --format json --output report.json

# write a SARIF 2.1.0 file for GitHub code scanning
repo-anti-rot scan --path . --format sarif --output repo-anti-rot.sarif

# scan many cloned repos under a directory
repo-anti-rot batch ./repos --out-dir ./reports
```

**Formats:** `terminal` (default), `json`, `md`, `sarif`.

## What it checks

Committed secrets · vulnerable dependencies (OSV, across npm/PyPI/Go/crates.io/
RubyGems/Packagist) · outdated & abandoned & unused dependencies · undocumented
env vars · dead code · commented-out code · leftover `console`/`debugger` ·
skipped/focused tests · Dockerfile hygiene · stale branches · aging TODOs ·
broken doc links · bus-factor risk · repo bloat.

Findings are grouped into categories, each scored by severity
(**critical −10 · warning −3 · info −0.5**), then rounded and clamped to a 0–100
score with an A–F grade. Tune it per-repo with an optional
[`.repo-anti-rot.json`](https://github.com/YpCIIIaK/repo-janitor#configuration-repo-anti-rotjson)
(ignore globs, mute rules, custom weights) or inline `// repo-anti-rot-ignore`
markers.

## More

This CLI is the engine behind the **Repo Anti-Rot** dashboard and GitHub Action.
Full docs, the dashboard, SARIF upload, the health badge and score-drop webhooks:

👉 **https://github.com/YpCIIIaK/repo-janitor**

MIT © YpCIIIaK
