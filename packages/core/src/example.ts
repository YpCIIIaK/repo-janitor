/**
 * Minimal in-memory smoke test of the engine — no real fs/git needed.
 * Run with: `npx tsx packages/core/src/example.ts`
 *
 * This proves the pipeline (context -> scanners -> scored report) end-to-end.
 * Replace the fake context with a real one (fast-glob + simple-git) in `cli`.
 */
import { runScan } from "./engine"
import type { ScanContext } from "./scanner"

const files = ["src/server/db.ts", "src/config.ts"]
const fakeFs: Record<string, string> = {
  "src/server/db.ts": `// TODO: pool these connections\nconst url = process.env.DATABASE_URL\nconst key = process.env.STRIPE_SECRET // FIXME: rotate this secret`,
  "src/config.ts": `export const region = process.env.AWS_REGION\nconst awsKey = "AKIAIOSFODNN7EXAMPLE"\nconst placeholder = "your-secret-here-placeholder"`,
  ".env.example": `DATABASE_URL=\nAWS_REGION=\nLEGACY_FLAG=`,
}

const ctx: ScanContext = {
  root: "/fake",
  repo: { owner: "acme", name: "demo", defaultBranch: "main" },
  files,
  readFile: async (rel) => fakeFs[rel] ?? null,
  git: {
    blameAgeDays: async () => 0,
    listBranches: async () => [
      { name: "main", lastCommit: "aaa", behind: 0, ageDays: 1 },
      { name: "feature/old-checkout", lastCommit: "bbb", behind: 247, ageDays: 210 },
      { name: "spike/idea", lastCommit: "ccc", behind: 12, ageDays: 95 },
    ],
  },
  log: (m) => console.log(m),
}

runScan(ctx).then((report) => {
  console.log(JSON.stringify(report, null, 2))
})
