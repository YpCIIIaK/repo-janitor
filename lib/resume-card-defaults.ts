import type { ResumeCardData } from "@/lib/resume-card"

/**
 * What the editor opens with.
 *
 * Separate from the generator so the layout code carries no one person's
 * details, and separate from the page so it can be diffed and edited without
 * touching JSX. Nothing here is stored anywhere — the editor loads this, you
 * change it in the browser, and you download the result. See `lib/session.ts`
 * for why the project keeps no per-person storage.
 */
export const DEFAULT_RESUME: ResumeCardData = {
  handle: "YpCIIIaK",
  headline: "Frontend Developer",
  subtitle: "·  Bots  ·  Automation  ·  Scripts  ·  AI",
  summary:
    "2+ years building web apps, trading tools, chatbots and browser extensions. " +
    "Looking for a Frontend / Fullstack role with a focus on AI & automation, in a small product team.",
  availability: "Open to work",
  stats: [
    { value: "2+", label: "years", note: "shipping production code" },
    { value: "6", label: "domains", note: "web · trading · bots · AI" },
    { value: "St.2", label: "Google Accelerator", note: "server resources for a year" },
    { value: "15+", label: "technologies", note: "across the stack" },
  ],
  stack: [
    {
      group: "Languages",
      items: [
        { name: "JavaScript", color: "#f7df1e" },
        { name: "TypeScript", color: "#3178c6" },
        { name: "PHP", color: "#777bb4" },
        { name: "Python", color: "#3776ab" },
        { name: "HTML5", color: "#e34f26" },
        { name: "CSS3", color: "#1572b6" },
        { name: "SQL", color: "#4479a1" },
      ],
    },
    {
      group: "Frontend",
      items: [
        { name: "React", color: "#61dafb" },
        { name: "Next.js", color: "#dddddd" },
        { name: "Vue.js", color: "#4fc08d" },
        { name: "Tailwind CSS", color: "#06b6d4" },
      ],
    },
    {
      group: "Backend",
      items: [
        { name: "Node.js", color: "#339933" },
        { name: "Symfony", color: "#dddddd" },
        { name: "Doctrine", color: "#fc6a31" },
        { name: "MySQL", color: "#4479a1" },
      ],
    },
    {
      group: "Tools",
      items: [
        { name: "Git", color: "#f05032" },
        { name: "Docker", color: "#2496ed" },
        { name: "VS Code", color: "#007acc" },
      ],
    },
    {
      group: "Dataviz",
      items: [
        { name: "Chart.js", color: "#ff6384" },
        { name: "D3.js", color: "#f9a03c" },
      ],
    },
    {
      group: "APIs",
      items: [
        { name: "Telegram Bot API", color: "#26a5e4" },
        { name: "Chrome Extensions", color: "#4285f4" },
        { name: "OpenRouter API", color: "#a78bfa" },
        { name: "VK API", color: "#0077ff" },
      ],
    },
  ],
  focus: [
    { title: "Frontend & UI/UX", note: "complex SPAs, responsive layouts, animations", color: "#5aa9ff" },
    { title: "Trading tools", note: "crypto analytics, backtesting, trading bots", color: "#7bd88f" },
    { title: "Chrome extensions", note: "automation, parsers, platform UI enhancements", color: "#ff9f45" },
    { title: "Bots & integrations", note: "Telegram/VK bots, payments, AI assistants", color: "#ff6b6b" },
    { title: "AI products", note: "multi-agent systems, RAG, usage analytics", color: "#a78bfa" },
  ],
  projects: [
    {
      title: "AI Multi-Agent Platform",
      meta: "in development",
      body: "Visual chain builder, RAG, usage analytics and interaction modes — debates, collaboration. Built on OpenRouter.",
      tags: ["React", "OpenRouter", "RAG"],
      color: "#ff9f45",
    },
    {
      title: "Vortan — Crypto Tools",
      meta: "4+ months · core team",
      body: "Frontend/fullstack for crypto analytics and trading-bot tooling. Advanced to Google Accelerator Stage 2 — a year of server resources.",
      tags: ["Frontend", "Fullstack", "Trading"],
      color: "#7bd88f",
    },
    {
      title: "Chrome Extensions for Trading",
      meta: "2+ months",
      body: "TraderNet and Binance: richer UI, extra metrics, automation, API integration. Plus a data parser, CSS detector and UI block copier.",
      tags: ["Chrome API", "Automation"],
      color: "#5aa9ff",
    },
    {
      title: "Telegram Bots — YourTar",
      meta: "~6 months",
      body: "Bots for a retail store, an online psychology school and a gym: reporting, notifications, admin panels, AI-automated reports.",
      tags: ["Telegram", "PHP", "AI"],
      color: "#ff6b6b",
    },
    {
      title: "Portfolio & Mini-Apps",
      meta: "7+ months",
      body: "Canvas sandbox, music visualizer, Notion clone and a browser effects library.",
      tags: ["React", "Tailwind"],
      color: "#a78bfa",
    },
    {
      title: "Internship — Paraweb",
      meta: "1 month",
      body: "Production work: layouts, components, bug fixes. Git-flow and code review.",
      tags: ["Git-flow", "Code review"],
      color: "#8b95a3",
    },
  ],
  education: {
    degree: "Bachelor's in Software Engineering",
    place: "TUSUR, Russia · 2028",
    notes: ["Also studied in IT programs at TSU (Russia)", "and AITU (Kazakhstan)."],
    certificates: ["Udemy — Complete JavaScript + React Course", "Google Accelerator — Stage 2 (AI project)"],
  },
  about:
    "Passionate about modern frontend, UI/UX and practical AI & automation. " +
    "Ship fast, iterate on feedback. Happiest on projects where people interact with data and AI live.",
  hobbies: ["basketball", "skiing", "swimming", "fitness"],
  contact: {
    title: "Let's talk",
    note: "Open to Frontend / Fullstack roles with AI & automation",
  },
  links: [
    { label: "Telegram", value: "@bigboyvova", color: "#5aa9ff" },
    { label: "Portfolio", value: "portfolioypshak.vercel.app", color: "#ff9f45" },
  ],
}
