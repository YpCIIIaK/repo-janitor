/**
 * Public mid-size repos shown as social proof on the landing strip.
 *
 * Kept separate from {@link FAMOUS_REPOS} (scan-form chips): this list is for
 * displaying grades, not for pre-filling the picker.
 */

export type ProofRepo = {
  label: string
  owner: string
  name: string
  url: string
}

export const PROOF_REPOS: readonly ProofRepo[] = [
  {
    label: "express",
    owner: "expressjs",
    name: "express",
    url: "https://github.com/expressjs/express",
  },
  {
    label: "zod",
    owner: "colinhacks",
    name: "zod",
    url: "https://github.com/colinhacks/zod",
  },
  {
    label: "commander",
    owner: "tj",
    name: "commander.js",
    url: "https://github.com/tj/commander.js",
  },
  {
    label: "ky",
    owner: "sindresorhus",
    name: "ky",
    url: "https://github.com/sindresorhus/ky",
  },
  {
    label: "ms",
    owner: "vercel",
    name: "ms",
    url: "https://github.com/vercel/ms",
  },
  {
    label: "debug",
    owner: "debug-js",
    name: "debug",
    url: "https://github.com/debug-js/debug",
  },
  {
    label: "chalk",
    owner: "chalk",
    name: "chalk",
    url: "https://github.com/chalk/chalk",
  },
  {
    label: "clsx",
    owner: "lukeed",
    name: "clsx",
    url: "https://github.com/lukeed/clsx",
  },
]

export type ProofSnapshotEntry = {
  owner: string
  name: string
  grade: "A" | "B" | "C" | "D" | "F"
  score: number
}

export type ProofSnapshot = {
  updatedAt: string
  repos: ProofSnapshotEntry[]
}
