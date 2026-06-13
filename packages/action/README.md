# Repo Anti-Rot GitHub Action

Runs the Repo Anti-Rot health scan in your CI, prints a report to the job summary, and
(optionally) POSTs the `ScanReport` to a Repo Anti-Rot dashboard's `/api/ingest`.

## Inputs

| Input           | Default   | Description                                                                 |
| --------------- | --------- | --------------------------------------------------------------------------- |
| `path`          | `.`       | Path to the repository to scan.                                             |
| `dashboard-url` | `""`      | Base URL of the dashboard. Report is POSTed to `<url>/api/ingest`. Empty → no upload. |
| `token`         | `""`      | Bearer token for the ingest endpoint (must match `REPO_ANTI_ROT_INGEST_TOKEN` on the server). |
| `fail-on`       | `never`   | Fail the job when the grade is at or below this letter (`A`–`F`), or `never`. |
| `github-token`  | `""`      | GitHub token (e.g. `${{ github.token }}`) for posting a sticky health comment on PRs. Needs `pull-requests: write`. Empty → no comment. |
| `comment-on-pr` | `true`    | Post/update a summary comment on the PR (requires `github-token` and a `pull_request` event). When a baseline is available the comment shows a score/finding delta vs the last stored scan. |
| `read-token`    | `""`      | Bearer token for reading stored reports (must match `REPO_ANTI_ROT_READ_TOKEN`). Lets the PR comment compute a delta against the dashboard's last scan; only needed when the read endpoint is gated. |
| `sarif-file`    | `""`      | Write findings as SARIF 2.1.0 to this path for `github/codeql-action/upload-sarif`. Empty → skip. |

## Outputs

`score` (0–100), `grade` (`A`–`F`), `issues` (count).

## Example workflow

```yaml
name: Repo Anti-Rot
on:
  schedule:
    - cron: "0 6 * * 1" # weekly, Monday 06:00 UTC
  pull_request:

permissions:
  contents: read
  pull-requests: write # required for the sticky PR comment

jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history → real blame ages + branch staleness
      - uses: your-org/repo-anti-rot/packages/action@v1
        with:
          dashboard-url: https://repo-anti-rot.example.com
          token: ${{ secrets.REPO_ANTI_ROT_INGEST_TOKEN }}
          github-token: ${{ github.token }}
          fail-on: D
```

A scan report is written to the **job summary**, the score/grade/issues are exposed
as step **outputs**, and the full report is uploaded to the dashboard when
`dashboard-url` is set. On pull requests, a single **sticky comment** (updated in
place on each run) summarizes the grade, severity counts, and the top findings.

## Notes

- `dist/index.cjs` is the bundled, self-contained entrypoint (no `node_modules` on
  the runner). Rebuild it with `pnpm build` after changing `src/`.
- Registry-based dependency findings need network access; without it the dependency
  scanner degrades to offline mode (unused-only) automatically.
