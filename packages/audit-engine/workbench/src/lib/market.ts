/* Рынок баунти и выбранные мишени — те же файлы, что у CLI.
   Источник истины один: ../data/market.json и ../data/targets.json.
   UI их читает и пишет, ничего своего не заводит, поэтому market.py,
   targets.py и страницы всегда видят одно и то же. */
import fs from "node:fs";
import path from "node:path";

import { workspaceRoot } from "@/lib/paths";

export type Asset = { name?: string; type?: string; url?: string; desc?: string };

export type Program = {
  site: string;
  pid: string;
  name: string;
  url: string;
  reward: number;
  currency: string;
  fee: number;
  kyc: boolean;
  reports: number; // -1 = площадка не публикует
  assets: Asset[];
  repos: string[];
  tags: string[];
  updated: string;
};

export type Target = Program & { slug: string };

export function marketPath() {
  return path.join(workspaceRoot(), "data", "market.json");
}

export function targetsPath() {
  return path.join(workspaceRoot(), "data", "targets.json");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadMarket(): Program[] {
  return readJson<Program[]>(marketPath(), []).map((p) => ({
    ...p,
    assets: p.assets || [],
    repos: p.repos || [],
    tags: p.tags || [],
  }));
}

export function loadTargets(): Target[] {
  return readJson<Target[]>(targetsPath(), []);
}

export function saveTargets(rows: Target[]) {
  fs.writeFileSync(targetsPath(), JSON.stringify(rows, null, 1), "utf8");
}

export function slugOf(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40) || "target";
}

/** Заявок на актив: единственный измеренный предиктор тесноты (r = -0.67). */
export function density(p: Program): number | null {
  if (p.reports < 0 || !p.assets.length) return null;
  return p.reports / p.assets.length;
}

function assetBlob(p: Program) {
  return (
    p.assets.map((a) => `${a.type || ""} ${a.name || ""} ${a.url || ""} ${a.desc || ""}`).join(" ") +
    " " +
    p.tags.join(" ")
  ).toLowerCase();
}

/** Есть ли в скоупе смарт-контракты. */
export function isSmartContract(p: Program) {
  const blob = assetBlob(p);
  return (
    blob.includes("smart") ||
    blob.includes("contract") ||
    blob.includes("solidity") ||
    blob.includes("blockchain")
  );
}

const WEB_HINT =
  /\b(web|website|url|domain|www|http|https|application|mobile|android|ios|api|wildcard|site)\b/;

/** Сайт, приложение или API в скоупе — не чистый on-chain. */
export function hasWebSurface(p: Program) {
  if (WEB_HINT.test(assetBlob(p))) return true;
  return p.assets.some((a) => /^https?:\/\//i.test(String(a.url || a.name || "")));
}

/** Веб-программа: есть HTTP-поверхность или нет контрактов вовсе. */
export function isWebProgram(p: Program) {
  if (hasWebSurface(p)) return true;
  return !isSmartContract(p);
}

/** Хосты из скоупа, которые можно дергать GET-ом. */
export function webHostsOf(p: Program): string[] {
  const hosts = new Set<string>();
  for (const a of p.assets) {
    for (const raw of [a.url, a.name, a.desc]) {
      const text = String(raw || "");
      for (const m of text.match(/https?:\/\/[^\s"'<>]+/gi) || []) {
        try {
          hosts.add(new URL(m.replace(/[.,);]+$/, "")).hostname.toLowerCase());
        } catch {
          /* skip */
        }
      }
      const bare = text.match(/^(?:\*\.)?([a-z0-9.-]+\.[a-z]{2,})$/i);
      if (bare) hosts.add(bare[1].toLowerCase().replace(/^\*\./, ""));
    }
  }
  return [...hosts].filter((h) => h.includes(".") && !h.endsWith(".eth"));
}

/** Тот же порядок, что в market.py: без комиссии и KYC выше, дальше по
    плотности. Неизвестная плотность стоит 1.5 — хуже разреженной, лучше
    явно тесной. Ноль туда ставить нельзя: он читался бы как «никто не искал». */
export function rank(a: Program, b: Program) {
  const k = (p: Program) => {
    const d = density(p);
    return [p.fee > 0 ? 1 : 0, p.kyc ? 1 : 0, d === null ? 1.5 : d, -p.reward];
  };
  const ka = k(a);
  const kb = k(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

export type TargetState = { brief: boolean; src: boolean; signals: number; lastRun: string };

export function targetState(slug: string): TargetState {
  const dir = path.join(workspaceRoot(), "data", "bounty", slug);
  const has = (p: string) => fs.existsSync(path.join(dir, p));
  let signals = 0;
  try {
    signals = fs.readdirSync(path.join(dir, "signals")).filter((f) => f.endsWith(".txt")).length;
  } catch {
    signals = 0;
  }
  let src = false;
  try {
    src = fs.readdirSync(path.join(dir, "src")).length > 0;
  } catch {
    src = false;
  }
  // Имя файла прогона начинается с времени, поэтому свежий — последний по
  // алфавиту. Разбирать содержимое ради ссылки незачем.
  let lastRun = "";
  try {
    const files = fs.readdirSync(path.join(dir, "runs")).filter((f) => f.endsWith(".jsonl"));
    files.sort();
    lastRun = files.length ? files[files.length - 1].replace(/\.jsonl$/, "") : "";
  } catch {
    lastRun = "";
  }
  return { brief: has("BRIEF.md"), src, signals, lastRun };
}
