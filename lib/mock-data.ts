export type Grade = "A" | "B" | "C" | "D" | "F"

export type Severity = "critical" | "warning" | "info"

export type IssueCategory =
  | "env"
  | "dependency"
  | "branch"
  | "todo"
  | "secret"
  | "dead-code"
  | "hygiene"

export interface Repository {
  id: string
  owner: string
  name: string
  defaultBranch: string
  grade: Grade
  score: number
  lastScan: string
}

export interface Issue {
  id: string
  category: IssueCategory
  severity: Severity
  title: string
  location: string
  ageDays: number
  detail: string
  /** Optional one-line snippet of the offending code (redacted for secrets). */
  evidence?: string
  /** Optional AI assessment, attached client-side when AI analysis is enabled. */
  aiNote?: string
}

export interface TrendPoint {
  date: string
  critical: number
  warning: number
  info: number
  score: number
}

export interface StatCard {
  label: string
  value: string
  delta: number
  deltaLabel: string
  tone: "good" | "bad" | "neutral"
}

export const categoryLabels: Record<IssueCategory, string> = {
  env: "Env Lifecycle",
  dependency: "Dependency Funeral",
  branch: "Stale Branch",
  todo: "TODO Debt",
  secret: "Secret in History",
  "dead-code": "Dead Code",
  hygiene: "Hygiene",
}

export const severityLabels: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}

export const demoRepositories: Repository[] = [
  {
    id: "repo-1",
    owner: "acme",
    name: "checkout-service",
    defaultBranch: "main",
    grade: "C",
    score: 64,
    lastScan: "2 hours ago",
  },
  {
    id: "repo-2",
    owner: "acme",
    name: "web-dashboard",
    defaultBranch: "main",
    grade: "B",
    score: 81,
    lastScan: "5 hours ago",
  },
  {
    id: "repo-3",
    owner: "acme",
    name: "legacy-api",
    defaultBranch: "master",
    grade: "F",
    score: 38,
    lastScan: "1 day ago",
  },
  {
    id: "repo-4",
    owner: "acme",
    name: "design-system",
    defaultBranch: "main",
    grade: "A",
    score: 94,
    lastScan: "3 hours ago",
  },
]

// Single source of truth for the dashboard's repo list.
// Empty by default → the app shows the welcome screen until a real scan is run.
// Swap to `demoRepositories` to preview the populated dashboard with sample data.
export const repositories: Repository[] = []

const issuesByRepo: Record<string, Issue[]> = {
  "repo-1": [
    {
      id: "r1-i1",
      category: "secret",
      severity: "critical",
      title: "Stripe restricted key committed in git history",
      location: "scripts/seed.ts @ 7b2c1a9",
      ageDays: 142,
      detail: "Matched pattern rk_live_[0-9a-zA-Z]{24}. Key still resolves to an active account.",
    },
    {
      id: "r1-i2",
      category: "env",
      severity: "critical",
      title: "STRIPE_SECRET_KEY referenced but missing from .env.example",
      location: "lib/payments.ts:14",
      ageDays: 88,
      detail: "Used in 3 files. New contributors will hit a runtime crash on first boot.",
    },
    {
      id: "r1-i3",
      category: "dependency",
      severity: "warning",
      title: "moment is installed but never imported",
      location: "package.json",
      ageDays: 230,
      detail: "Last published 2 years ago. 0 import statements found across the codebase.",
    },
    {
      id: "r1-i4",
      category: "branch",
      severity: "warning",
      title: "feature/old-checkout is 247 commits behind main",
      location: "origin/feature/old-checkout",
      ageDays: 198,
      detail: "Last commit 6 months ago by a former contributor. Likely safe to delete.",
    },
    {
      id: "r1-i5",
      category: "todo",
      severity: "info",
      title: "TODO: handle partial refund edge case",
      location: "lib/refunds.ts:88",
      ageDays: 320,
      detail: "Authored 10 months ago. Oldest open TODO in the repository.",
    },
    {
      id: "r1-i6",
      category: "dead-code",
      severity: "info",
      title: "Unused export formatLegacyAmount",
      location: "lib/money.ts:51",
      ageDays: 274,
      detail: "Exported symbol with zero references in the import graph.",
    },
  ],
  "repo-2": [
    {
      id: "r2-i1",
      category: "env",
      severity: "warning",
      title: "NEXT_PUBLIC_ANALYTICS_ID declared but never read",
      location: ".env.example:22",
      ageDays: 156,
      detail: "Declared in example env but no process.env access anywhere in source.",
    },
    {
      id: "r2-i2",
      category: "dependency",
      severity: "warning",
      title: "lodash is mostly tree-shakeable but imported wholesale",
      location: "components/table.tsx:3",
      ageDays: 120,
      detail: "Full lodash import adds ~70kb. Prefer per-method imports.",
    },
    {
      id: "r2-i3",
      category: "todo",
      severity: "info",
      title: "FIXME: remove feature flag after rollout",
      location: "app/dashboard/page.tsx:41",
      ageDays: 210,
      detail: "Flag fully rolled out 4 months ago. Dead conditional branch.",
    },
    {
      id: "r2-i4",
      category: "branch",
      severity: "info",
      title: "hotfix/nav-typo merged but not deleted",
      location: "origin/hotfix/nav-typo",
      ageDays: 64,
      detail: "Branch fully merged into main. Remote ref can be pruned.",
    },
    {
      id: "r2-i5",
      category: "dead-code",
      severity: "info",
      title: "Unused component <LegacyChart />",
      location: "components/legacy-chart.tsx",
      ageDays: 180,
      detail: "Component has zero references since the dashboard redesign.",
    },
  ],
  "repo-3": [
    {
      id: "r3-i1",
      category: "secret",
      severity: "critical",
      title: "AWS access key committed in git history",
      location: "config/deploy.sh @ a3f91c2",
      ageDays: 412,
      detail: "Matched pattern AKIA[0-9A-Z]{16}. Key still references an active IAM user.",
    },
    {
      id: "r3-i2",
      category: "secret",
      severity: "critical",
      title: "Database password in committed docker-compose.yml",
      location: "docker-compose.yml:18 @ 4c1aa90",
      ageDays: 605,
      detail: "Plaintext POSTGRES_PASSWORD present across 40+ historical commits.",
    },
    {
      id: "r3-i3",
      category: "env",
      severity: "critical",
      title: "12 env vars referenced with no .env.example at all",
      location: "src/**",
      ageDays: 720,
      detail: "Repository has no env template. Onboarding requires tribal knowledge.",
    },
    {
      id: "r3-i4",
      category: "dependency",
      severity: "warning",
      title: "request is deprecated and unmaintained",
      location: "package.json",
      ageDays: 900,
      detail: "Package fully deprecated since 2020. 14 transitive vulnerabilities.",
    },
    {
      id: "r3-i5",
      category: "branch",
      severity: "warning",
      title: "9 branches over 1 year stale",
      location: "origin/*",
      ageDays: 540,
      detail: "Bulk of remote branches abandoned. Repo navigation is cluttered.",
    },
    {
      id: "r3-i6",
      category: "todo",
      severity: "info",
      title: "TODO: rewrite this whole module",
      location: "src/legacy/handler.js:2",
      ageDays: 1100,
      detail: "Authored 3 years ago. Module still in production.",
    },
  ],
  "repo-4": [
    {
      id: "r4-i1",
      category: "todo",
      severity: "info",
      title: "TODO: add Storybook story for <Tooltip />",
      location: "src/tooltip/tooltip.tsx:120",
      ageDays: 45,
      detail: "Minor documentation gap. Component is fully tested otherwise.",
    },
    {
      id: "r4-i2",
      category: "dependency",
      severity: "info",
      title: "1 devDependency one minor version behind",
      location: "package.json",
      ageDays: 20,
      detail: "Non-breaking. Safe to bump in next maintenance pass.",
    },
  ],
}

const trendByRepo: Record<string, TrendPoint[]> = {
  "repo-1": [
    { date: "Jan", critical: 1, warning: 9, info: 14, score: 71 },
    { date: "Feb", critical: 1, warning: 8, info: 13, score: 73 },
    { date: "Mar", critical: 2, warning: 10, info: 15, score: 66 },
    { date: "Apr", critical: 2, warning: 9, info: 12, score: 68 },
    { date: "May", critical: 1, warning: 7, info: 11, score: 75 },
    { date: "Jun", critical: 2, warning: 6, info: 10, score: 70 },
    { date: "Jul", critical: 2, warning: 5, info: 9, score: 67 },
    { date: "Aug", critical: 2, warning: 2, info: 2, score: 64 },
  ],
  "repo-2": [
    { date: "Jan", critical: 1, warning: 6, info: 10, score: 74 },
    { date: "Feb", critical: 1, warning: 5, info: 9, score: 76 },
    { date: "Mar", critical: 0, warning: 5, info: 8, score: 79 },
    { date: "Apr", critical: 0, warning: 4, info: 8, score: 80 },
    { date: "May", critical: 0, warning: 3, info: 7, score: 82 },
    { date: "Jun", critical: 0, warning: 3, info: 6, score: 81 },
    { date: "Jul", critical: 0, warning: 2, info: 5, score: 83 },
    { date: "Aug", critical: 0, warning: 2, info: 3, score: 81 },
  ],
  "repo-3": [
    { date: "Jan", critical: 2, warning: 11, info: 18, score: 48 },
    { date: "Feb", critical: 2, warning: 12, info: 19, score: 46 },
    { date: "Mar", critical: 3, warning: 13, info: 20, score: 42 },
    { date: "Apr", critical: 3, warning: 12, info: 21, score: 41 },
    { date: "May", critical: 3, warning: 13, info: 22, score: 40 },
    { date: "Jun", critical: 3, warning: 14, info: 22, score: 39 },
    { date: "Jul", critical: 3, warning: 14, info: 23, score: 38 },
    { date: "Aug", critical: 3, warning: 2, info: 1, score: 38 },
  ],
  "repo-4": [
    { date: "Jan", critical: 0, warning: 2, info: 5, score: 88 },
    { date: "Feb", critical: 0, warning: 1, info: 4, score: 90 },
    { date: "Mar", critical: 0, warning: 1, info: 4, score: 91 },
    { date: "Apr", critical: 0, warning: 0, info: 3, score: 93 },
    { date: "May", critical: 0, warning: 0, info: 3, score: 93 },
    { date: "Jun", critical: 0, warning: 0, info: 2, score: 94 },
    { date: "Jul", critical: 0, warning: 1, info: 2, score: 93 },
    { date: "Aug", critical: 0, warning: 0, info: 2, score: 94 },
  ],
}

function countBySeverity(list: Issue[], sev: Severity) {
  return list.filter((i) => i.severity === sev).length
}

export function getIssues(repoId: string): Issue[] {
  return issuesByRepo[repoId] ?? []
}

export function getTrend(repoId: string): TrendPoint[] {
  return trendByRepo[repoId] ?? []
}

export function getStats(repoId: string): StatCard[] {
  const repo = repositories.find((r) => r.id === repoId)
  const list = getIssues(repoId)
  const t = getTrend(repoId)
  const last = t[t.length - 1]
  const prev = t[t.length - 2] ?? last
  const scoreDelta = last && prev ? last.score - prev.score : 0
  const critical = countBySeverity(list, "critical")
  const critPrev = prev?.critical ?? critical
  const branches = list.filter((i) => i.category === "branch").length

  return [
    {
      label: "Health Score",
      value: String(repo?.score ?? last?.score ?? 0),
      delta: scoreDelta,
      deltaLabel: "vs last month",
      tone: scoreDelta > 0 ? "good" : scoreDelta < 0 ? "bad" : "neutral",
    },
    {
      label: "Critical Issues",
      value: String(critical),
      delta: critical - critPrev,
      deltaLabel: critical >= critPrev ? "new this month" : "resolved",
      tone: critical > 0 ? "bad" : "good",
    },
    {
      label: "Open Issues",
      value: String(list.length),
      delta: 0,
      deltaLabel: "tracked",
      tone: list.length === 0 ? "good" : "neutral",
    },
    {
      label: "Stale Branches",
      value: String(branches),
      delta: 0,
      deltaLabel: branches === 0 ? "all clean" : "needs pruning",
      tone: branches > 0 ? "neutral" : "good",
    },
  ]
}
