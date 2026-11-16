# Contributing

Thanks for helping improve repo-janitor.

## Setup

```bash
pnpm install
pnpm run build:packages   # core, CLI, GitHub Action
pnpm dev                  # dashboard on http://localhost:3000
```

Node 22 and pnpm 10 are expected.

## Before you open a pull request

```bash
pnpm test                         # dashboard + package tests
node --test benchmark/*.test.mjs  # benchmark helpers
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

## Changing a scanner

Detector changes are judged against the labelled benchmark, not by eye:

1. Add a regression test in `packages/core` that fails before your change.
2. Run `node benchmark/score.mjs --check`. It must report no regressions and no increase in lost true positives.
3. See `benchmark/ROUTINE.md` for the full rescan/calibration routine.

Never name a repository with a security finding in issues, PRs or public stats.

## Style

- TypeScript, ESLint config in `eslint.config.mjs`.
- Small, focused commits; describe *why* in the message.
