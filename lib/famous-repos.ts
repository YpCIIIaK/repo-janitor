/**
 * Preset public repos for the landing “try one of these” strip.
 *
 * Kept small and mid-sized so a free-tier scan finishes before the visitor
 * walks away. Labels are short so chips stay readable.
 */

export type FamousRepo = {
  label: string
  owner: string
  name: string
  url: string
}

export const FAMOUS_REPOS: readonly FamousRepo[] = [
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
]

/** Two mid-size repos for a one-click compare batch. */
export const COMPARE_PAIR: readonly FamousRepo[] = [FAMOUS_REPOS[0], FAMOUS_REPOS[1]]
