import type { ResumeCardData } from "@/lib/resume-card"

/**
 * What the editor opens with.
 *
 * Separate from the generator so the layout code carries no one person's
 * details, and separate from the page so it can be diffed and edited without
 * touching JSX. Nothing here is stored anywhere — the editor loads this, you
 * change it in the browser, and you download the result. See `lib/session.ts`
 * for why the project keeps no per-person storage.
 *
 * ## This is a selection, not a dump
 *
 * The CV behind it runs to several pages. A card that tried to hold all of it
 * would be a wall nobody reads, so each section keeps what is specific and
 * drops what every CV claims: concrete versions over "modern stack", the one
 * measurable outcome over the list of responsibilities. Anything cut is still
 * in the CV, which is the document that has room for it.
 */
export const DEFAULT_RESUME: ResumeCardData = {
  handle: "YpCIIIaK",
  headline: "Frontend / Fullstack",
  subtitle: "·  Realtime  ·  Trading  ·  Bots  ·  AI",
  summary:
    "Currently at a web agency shipping client sites on WordPress and Bitrix. " +
    "Before that: two startups, an HR-tech internship and privacy-first pet projects — " +
    "trading tools, local Go agents, chatbots and browser extensions. " +
    "React, Angular, Next.js and Vue on the front; Go, Node, PHP behind them.",
  availability: "Open to offers",
  stats: [
    { value: "2+", label: "years", note: "shipping production code" },
    { value: "4", label: "client sites", note: "agency · live production" },
    { value: "St.2", label: "Google Accelerator", note: "a year of server resources" },
    { value: "227k", label: "docs reindexed", note: "a filter nobody could use" },
  ],
  stack: [
    {
      group: "Languages",
      items: [
        { name: "TypeScript 5", color: "#3178c6" },
        { name: "JavaScript ES6+", color: "#f7df1e" },
        { name: "Go 1.22", color: "#00add8" },
        { name: "PHP 8.4", color: "#777bb4" },
        { name: "Python", color: "#3776ab" },
        { name: "SQL", color: "#4479a1" },
      ],
    },
    {
      group: "Frontend",
      items: [
        { name: "React 18/19", color: "#61dafb" },
        { name: "Angular 19", color: "#dd0031" },
        { name: "Next.js App Router", color: "#dddddd" },
        { name: "Vue 3", color: "#4fc08d" },
        { name: "Vite", color: "#a78bfa" },
        { name: "Tailwind", color: "#06b6d4" },
        { name: "SCSS", color: "#cf649a" },
      ],
    },
    {
      group: "CMS",
      items: [
        { name: "WordPress", color: "#21759b" },
        { name: "custom themes", color: "#21759b" },
        { name: "ACF PRO", color: "#00d3ae" },
        { name: "Contact Form 7", color: "#61b8d4" },
        { name: "Bitrix", color: "#1c9ed9" },
        { name: "Yoast + Polylang", color: "#a4286a" },
      ],
    },
    {
      group: "State",
      items: [
        { name: "Redux Toolkit", color: "#764abc" },
        { name: "Angular Signals", color: "#dd0031" },
        { name: "RxJS 7", color: "#e0234e" },
        { name: "useSyncExternalStore", color: "#61dafb" },
      ],
    },
    {
      group: "Backend",
      items: [
        { name: "Node.js 22", color: "#339933" },
        { name: "NestJS", color: "#e0234e" },
        { name: "Symfony 8", color: "#dddddd" },
        { name: "Doctrine ORM", color: "#fc6a31" },
        { name: "PostgreSQL", color: "#4169e1" },
        { name: "OpenSearch", color: "#ffa41c" },
      ],
    },
    {
      group: "Realtime",
      items: [
        { name: "WebSocket", color: "#7bd88f" },
        { name: "gorilla/websocket", color: "#00add8" },
        { name: "Binance WS/REST", color: "#f0b90b" },
        { name: "gopsutil", color: "#00add8" },
        { name: "NDJSON streaming", color: "#8b95a3" },
      ],
    },
    {
      group: "Dataviz",
      items: [
        { name: "d3-geo + topojson", color: "#f9a03c" },
        { name: "Lightweight Charts", color: "#26a5e4" },
        { name: "Recharts", color: "#ff6384" },
        { name: "custom SVG charts", color: "#a78bfa" },
        { name: "GSAP + ScrollTrigger", color: "#88ce02" },
        { name: "Swiper", color: "#0080ff" },
      ],
    },
    {
      group: "Infra",
      items: [
        { name: "GitHub Actions", color: "#dddddd" },
        { name: "Docker", color: "#2496ed" },
        { name: "pnpm workspaces", color: "#f9ad00" },
        { name: "ArgoCD", color: "#ef7b4d" },
        { name: "SARIF 2.1", color: "#8b95a3" },
        { name: "Vitest", color: "#7bd88f" },
      ],
    },
  ],
  focus: [
    { title: "Frontend & UI/UX", note: "complex SPAs, Cmd-K palette, virtual scroll", color: "#5aa9ff" },
    { title: "Realtime data", note: "WS with backoff, multiplexed typed streams", color: "#7bd88f" },
    { title: "Trading tools", note: "strategy builders, backtesting, live charts", color: "#f0b90b" },
    { title: "Local-first agents", note: "Go + gopsutil, nothing leaves the machine", color: "#00add8" },
    { title: "Bots & integrations", note: "Telegram/VK, payments, AI assistants", color: "#ff6b6b" },
    { title: "AI products", note: "multi-agent chains, RAG, usage analytics", color: "#a78bfa" },
    { title: "CMS delivery", note: "custom themes, content models, safe deploys", color: "#21759b" },
  ],
  projects: [
    {
      title: "Corporate homepage build",
      meta: "agency · Bitrix + vanilla JS",
      body: "11 new sections into a live site's existing style system, reusing its modals, carousels and grid rather than adding a parallel one. Fluid typography off a single CSS multiplier, cut-corner shapes in clip-path instead of images. Handed over documented and split into existing vs new.",
      tags: ["Bitrix", "Swiper", "clip-path"],
      color: "#1c9ed9",
    },
    {
      title: "WordPress theme from scratch",
      meta: "agency · PHP + ACF PRO",
      body: "Static markup into a custom theme: CPTs, ACF content model, options pages, forms. Migrated ACF groups from code into the database without losing data, then moved the whole site to production — files, DB and media — with serialize-safe URL replacement.",
      tags: ["WordPress", "ACF PRO", "WP-CLI", "Docker"],
      color: "#21759b",
    },
    {
      title: "SEO audit & lead capture",
      meta: "agency · 4 languages",
      body: "Technical audit of a multilingual site: killed duplicate H1s across dozens of pages, built regional landing pages with correct canonical and noindex. Floating contact widget with three forms, GA4 events on every path to a conversation.",
      tags: ["Yoast", "Polylang", "CF7", "GA4"],
      color: "#a4286a",
    },
    {
      title: "Client sites — support",
      meta: "agency · production, no SSH",
      body: "Feature work on live medical and landing-page sites: CPT ordering rules, editor-facing repeaters, Bitrix24 CRM lead delivery. Every change diffed against the server copy first and written to be additive — an empty field keeps the old behaviour.",
      tags: ["WP_Query", "Bitrix24 REST", "GSAP"],
      color: "#00d3ae",
    },
    {
      title: "HR-tech candidate search",
      meta: "internship · React + NestJS",
      body: "Search UI and filters over OpenSearch. Wrote the experience calculator that merges overlapping employment ranges, then backfilled 227k documents whose totalExperience was zero — the range filter had never worked.",
      tags: ["React 18", "NestJS", "OpenSearch", "Redux"],
      color: "#5aa9ff",
    },
    {
      title: "Vortan — crypto tools",
      meta: "startup · 4+ months · core",
      body: "Led frontend and part of the backend for strategy builders, backtesting and trading-bot control. Team reached Google Accelerator Stage 2 — a year of server resources.",
      tags: ["Frontend lead", "Backtesting", "Charts"],
      color: "#f0b90b",
    },
    {
      title: "AI multi-agent platform",
      meta: "current main project",
      body: "An arena for AI agents: visual chain builder combining models and scripts without code, RAG and thinking modes, debate and collaboration formats, plus cost and error analytics.",
      tags: ["Next.js", "OpenRouter", "RAG"],
      color: "#a78bfa",
    },
    {
      title: "WiFi Analyzer",
      meta: "own product · Go + React",
      body: "Privacy-first local analyser: one poll loop fans snapshots to every client, so N connections is not N syscalls. Offline geo-IP, d3-geo world map, evil-twin detection. Origin locked to localhost so no site can read your process list.",
      tags: ["Go", "WebSocket", "d3-geo"],
      color: "#00add8",
    },
    {
      title: "PC Health Monitor",
      meta: "own product · in progress",
      body: "Catches unnatural load — hidden miners, thermal throttling, disk decay. Per-process CPU% as a delta between polls rather than the lifetime average the library hands you. 24h ring buffer plus rotated JSONL.",
      tags: ["Go", "gopsutil", "React"],
      color: "#7bd88f",
    },
    {
      title: "Repo Anti-Rot",
      meta: "own product · 17 scanners",
      body: "Scores a repository 0–100 and tracks its decay. One engine in three wrappers: CLI, GitHub Action with SARIF and PR comments, and a Next.js dashboard. ~237 Vitest tests against deterministic stubs.",
      tags: ["Next.js", "GitHub Action", "OSV"],
      color: "#ff9f45",
    },
    {
      title: "Trading Chrome extensions",
      meta: "2+ months · MV3",
      body: "TraderNet and Binance: extra panels and metrics, automation, market monitoring and API integration. Plus a data parser, CSS detector and UI block copier.",
      tags: ["Manifest V3", "Service Workers"],
      color: "#4285f4",
    },
    {
      title: "Telegram bots — YourTar",
      meta: "~6 months · PHP/Python",
      body: "Reporting for a retail store, an online psychology school and a gym: user flows, admin panels, notifications, and AI-automated reports that cut the manual work.",
      tags: ["Telegram", "PHP", "AI"],
      color: "#26a5e4",
    },
  ],
  education: {
    degree: "BSc Software Engineering",
    place: "TUSUR, Russia · expected 2028",
    notes: [
      "Scholarship IT programmes at TSU (Russia)",
      "and AITU (Kazakhstan). Entered three",
      "state-funded programmes across fields.",
    ],
    certificates: [
      "Udemy — Complete JavaScript + React",
      "Google Accelerator — Stage 2 (AI project)",
    ],
  },
  about:
    "Comfortable on both sides: components, states and layout, and the logic behind them — APIs, bots, agents, AI. " +
    "Ship fast, then improve on feedback. Happiest where a web interface meets live data.",
  hobbies: ["basketball", "water polo", "skiing", "fitness"],
  contact: {
    title: "Let's talk",
    note: "Open to Frontend / Fullstack — realtime, trading, AI, automation",
  },
  links: [
    { label: "Telegram", value: "@bigboyvova", color: "#26a5e4" },
    { label: "Portfolio", value: "portfolioypshak.vercel.app", color: "#ff9f45" },
  ],
}
