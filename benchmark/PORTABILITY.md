# Windows rescan investigation (2026-11-05)

The first Windows rescan lost 29 labelled true positives relative to the
`49fc295` bench-data snapshot. No scanners reported runtime failures.

## Causes and fixes

- 25 TODO findings: CRLF leaves a trailing carriage return in comment lines.
  The marker regex did not match it. Trim trailing whitespace before matching;
  regression tests cover Python comments and JavaScript block comments.
- Commented-code and duplicate-code: asynchronous filesystem enumeration changes
  traversal order, affecting caps and which duplicate occurrence supplies an ID.
  Sort the collected paths before running scanners. A repeated context test
  checks ordering across nested paths and mixed case.
- Two doc-link labels were incorrect, not lost vulnerabilities. Git mode 120000
  confirms that both targets are symlinks to existing files at the pinned SHAs:
  - ansible-ansible-lint `ea824e77fb7ed8d84048fd53c0b641ce96cc11cf`:
    `docs/rules/deprecated-local-action.md` points to
    `../../src/ansiblelint/rules/deprecated_local_action.md`.
  - supabase-supabase-flutter `826a82bbc68b95611fa85faa1d1168d9eadd99b0`:
    `packages/supabase_flutter/skills/supabase-flutter-migrate-v3/references/migration-v2-v3.md`
    points to `../../../../../MIGRATION.md`.
  The original Linux file enumerator omits symlinks; Windows checks out link
  placeholders as files. The doc scanner now asks the boundary-checked reader
  whether a target exists before reporting it missing. Both labels change to FP.

## Historical baseline correction

The baseline is recalculated against the **old archived results**, not the new
implementation, using only the two corrected labels. Historical doc-link counts
are now 16 TP / 9 FP (64%, previously 18 / 7 = 72%); overall counts are
566 TP / 410 FP (58.0%, previously 568 / 408 = 58.2%). All other thresholds,
scanner baselines, and the historical allowance of 36 lost TPs stay unchanged.
This prevents treating removal of two verified false positives as a regression.

## Execution reliability

The runner enables Git long paths per checkout, propagates failures through
resume.mjs, rejects reports with failed scanners, and stages output before
replacing a previous report. Integration tests exercise success, CLI failure,
and partial scanner failure.

Four repositories require a Linux filesystem: searxng-searxng, hackclub-sprig,
prestashop-docs, liveblocks-liveblocks. A Windows bind mount for their clones
does not solve invalid names; their clone cache must be a Linux Docker volume.
Only results/history are shared with the host. The Linux run uses the same CLI
build and direct dependency versions (commander 12.1.0, tinyglobby 0.2.17,
simple-git 4.0.2, zod 4.4.3).
