import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { GET } from "@/app/api/card/person/[login]/route"
import {
  STATS_SAMPLE,
  joinedYearOf,
  personCardMarkdown,
  projectPerson,
  projectRepoStats,
  repoSearchUrl,
  userApiUrl,
} from "@/lib/github-user"

/**
 * The person-card endpoint is public and its only parameter is a path segment,
 * so these tests are mostly about that boundary: what reaches GitHub after a
 * hostile path, and what the reader gets when the lookup fails.
 */

const PAYLOAD = {
  login: "octocat",
  name: "The Octocat",
  bio: "A cat that codes.",
  location: "San Francisco",
  company: "@github",
  created_at: "2011-01-25T18:44:36Z",
  public_repos: 8,
  followers: 14200,
  email: "octocat@example.com",
  hireable: true,
}

const call = (login: string, qs = "") =>
  GET(new Request(`https://x.test/api/card/person/${login}${qs ? `?${qs}` : ""}`), {
    params: Promise.resolve({ login }),
  })

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => PAYLOAD })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("projectPerson", () => {
  it("keeps only the fields the card draws", () => {
    expect(projectPerson(PAYLOAD)).toEqual({
      login: "octocat",
      name: "The Octocat",
      bio: "A cat that codes.",
      location: "San Francisco",
      company: "@github",
      joinedYear: 2011,
      publicRepos: 8,
      followers: 14200,
    })
  })

  it("does not carry the email through", () => {
    // Not an oversight to be "fixed" later: an address a person put on a profile
    // page is not something they asked to have baked into a travelling image.
    expect(JSON.stringify(projectPerson(PAYLOAD))).not.toContain("octocat@example.com")
  })

  it("returns null for a payload that is not a user", () => {
    expect(projectPerson({ message: "Not Found" })).toBeNull()
    expect(projectPerson(null)).toBeNull()
    expect(projectPerson("nonsense")).toBeNull()
  })

  it("treats blank strings as absent", () => {
    const p = projectPerson({ login: "a", name: "  ", bio: "" })
    expect(p?.name).toBeNull()
    expect(p?.bio).toBeNull()
  })

  it("refuses a negative or non-numeric count rather than rendering it", () => {
    const p = projectPerson({ login: "a", followers: -5, public_repos: "many" })
    expect(p?.followers).toBeNull()
    expect(p?.publicRepos).toBeNull()
  })
})

describe("joinedYearOf", () => {
  it("reads the year in UTC", () => {
    expect(joinedYearOf("2011-01-25T18:44:36Z")).toBe(2011)
  })

  it("returns null for junk instead of a NaN year", () => {
    expect(joinedYearOf("not a date")).toBeNull()
    expect(joinedYearOf(null)).toBeNull()
    expect(joinedYearOf(12345)).toBeNull()
  })
})

describe("GET /api/card/person/[login]", () => {
  it("renders the person's card as an SVG", async () => {
    const res = await call("octocat")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml")
    const body = await res.text()
    expect(body).toContain("@octocat")
    expect(body).toContain("The Octocat")
    // 14200 → "14k": a tenth is only shown below 10k, as everywhere else here.
    expect(body).toContain("14k")
  })

  it("refuses anything that is not a GitHub username", async () => {
    // Without this gate a crafted path walks out of /users/ into another
    // endpoint and renders whatever comes back under somebody's name.
    for (const bad of ["../orgs/github", "a b", "-lead", "x".repeat(40)]) {
      expect((await call(bad)).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("asks GitHub only for the users endpoint", async () => {
    await call("octocat")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(userApiUrl("octocat"))
    expect(userApiUrl("octocat")).toBe("https://api.github.com/users/octocat")
  })

  it("still renders a card when the lookup fails", async () => {
    // A broken image in a README is worse than a sparse card, and a card built
    // from nothing but a handle is a legitimate card here.
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const res = await call("octocat")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("@octocat")
  })

  it("survives a network error and a timeout", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"))
    const res = await call("octocat")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("@octocat")
  })

  it("caches a failed lookup briefly and a good one for longer", async () => {
    const good = (await call("octocat")).headers.get("Cache-Control")
    expect(good).toContain("max-age=3600")

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const bad = (await call("octocat")).headers.get("Cache-Control")
    expect(bad).toContain("max-age=120")
  })

  it("takes the wide layout and ignores anything else", async () => {
    expect(await (await call("octocat", "size=wide")).text()).toContain('width="480"')
    expect(await (await call("octocat", "size=huge")).text()).toContain('width="300"')
    expect(await (await call("octocat")).text()).toContain('width="300"')
  })

  it("takes the light theme and ignores anything else", async () => {
    expect(await (await call("octocat", "theme=light")).text()).toContain("#f6f8fa")
    expect(await (await call("octocat", "theme=neon")).text()).not.toContain("#f6f8fa")
  })

  it("sends a token when one is configured, and works without", async () => {
    const previous = process.env.GITHUB_TOKEN
    try {
      delete process.env.GITHUB_TOKEN
      await call("octocat")
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()

      fetchMock.mockClear()
      process.env.GITHUB_TOKEN = "t"
      await call("octocat")
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer t")
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = previous
    }
  })
})

const SEARCH = {
  total_count: 3,
  items: [
    { name: "react", language: "JavaScript", stargazers_count: 200_000 },
    { name: "redux", language: "TypeScript", stargazers_count: 60_000 },
    { name: "notes", language: "JavaScript", stargazers_count: 40 },
  ],
}

describe("projectRepoStats", () => {
  it("names the most-starred repository and sums the sample", () => {
    expect(projectRepoStats(SEARCH)).toEqual({
      topLanguage: "JavaScript",
      starsReceived: 260_040,
      starsApproximate: false,
      bestKnown: "react",
    })
  })

  it("flags the total as approximate once the sample is capped", () => {
    // Beyond a page the sum is a floor, not a total, and the card says so.
    const capped = { total_count: 400, items: SEARCH.items }
    expect(projectRepoStats(capped).starsApproximate).toBe(true)
    expect(projectRepoStats(SEARCH).starsApproximate).toBe(false)
  })

  it("breaks a language tie toward the better-known work", () => {
    // Items arrive most-starred first, so the earlier entry wins a tie.
    const tied = {
      total_count: 2,
      items: [
        { name: "a", language: "Rust", stargazers_count: 900 },
        { name: "b", language: "Go", stargazers_count: 10 },
      ],
    }
    expect(projectRepoStats(tied).topLanguage).toBe("Rust")
  })

  it("returns nothing at all for somebody with no public repositories", () => {
    // "0 stars" is a claim; an absent row is the truth.
    expect(projectRepoStats({ total_count: 0, items: [] })).toEqual({
      topLanguage: null,
      starsReceived: null,
      starsApproximate: false,
      bestKnown: null,
    })
  })

  it("survives a payload that is not a search result", () => {
    expect(projectRepoStats(null).bestKnown).toBeNull()
    expect(projectRepoStats({ items: "nope" }).bestKnown).toBeNull()
    expect(projectRepoStats({ items: [{}] }).starsReceived).toBe(0)
  })

  it("keeps a real zero when repositories exist but nobody starred them", () => {
    const quiet = { total_count: 1, items: [{ name: "scratch", stargazers_count: 0 }] }
    expect(projectRepoStats(quiet).starsReceived).toBe(0)
    expect(projectRepoStats(quiet).bestKnown).toBe("scratch")
  })
})

describe("repoSearchUrl", () => {
  it("sorts by stars and excludes forks", () => {
    const url = repoSearchUrl("octocat")
    // Sorting by stars is what makes the sample cap honest, and excluding forks
    // stops anybody manufacturing a total by forking popular projects.
    expect(url).toContain("sort=stars")
    expect(url).toContain(`per_page=${STATS_SAMPLE}`)
    expect(decodeURIComponent(url)).toContain("user:octocat fork:false")
  })
})

describe("GET /api/card/person/[login]?detail=full", () => {
  const detailCall = async (qs: string) => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/search/")
        ? { ok: true, json: async () => SEARCH }
        : { ok: true, json: async () => PAYLOAD },
    )
    return (await call("octocat", qs)).text()
  }

  it("adds the detailed rows", async () => {
    const body = await detailCall("detail=full")
    expect(body).toContain("top language")
    expect(body).toContain("JavaScript")
    expect(body).toContain("best known")
    expect(body).toContain("react")
  })

  it("costs nothing extra by default", async () => {
    // The search endpoint allows ten calls a minute, which is most of the reason
    // this is opt-in rather than always on.
    await call("octocat")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).not.toContain("/search/")
  })

  it("does not show the detailed rows without the flag", async () => {
    expect(await (await call("octocat")).text()).not.toContain("top language")
  })

  it("keeps the profile rows when only the search fails", async () => {
    // A rate-limited search must cost the detailed rows and nothing else.
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/search/")
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => PAYLOAD },
    )
    const body = await (await call("octocat", "detail=full")).text()
    expect(body).toContain("The Octocat")
    expect(body).toContain("followers")
    expect(body).not.toContain("top language")
  })

  it("marks a capped total with a tilde", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/search/")
        ? { ok: true, json: async () => ({ total_count: 400, items: SEARCH.items }) }
        : { ok: true, json: async () => PAYLOAD },
    )
    expect(await (await call("octocat", "detail=full")).text()).toContain("~260k")
  })
})

describe("personCardMarkdown", () => {
  it("links the card back to the profile it was built from", () => {
    expect(personCardMarkdown("octocat", "https://x.test/")).toBe(
      "[![octocat](https://x.test/api/card/person/octocat)](https://github.com/octocat)",
    )
  })
})
