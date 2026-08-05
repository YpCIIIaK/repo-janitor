import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { GET } from "@/app/api/card/person/[login]/route"
import { joinedYearOf, personCardMarkdown, projectPerson, userApiUrl } from "@/lib/github-user"

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

describe("personCardMarkdown", () => {
  it("links the card back to the profile it was built from", () => {
    expect(personCardMarkdown("octocat", "https://x.test/")).toBe(
      "[![octocat](https://x.test/api/card/person/octocat)](https://github.com/octocat)",
    )
  })
})
