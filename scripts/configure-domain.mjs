import { readFile, writeFile, rename } from "node:fs/promises";

const domain = (process.argv[2] || "").trim().toLowerCase();
if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
  throw new Error("Provide a domain without protocol or path: node scripts/configure-domain.mjs repo-janitor.app");
}
const file = ".env.local";
let content = await readFile(file, "utf8");
for (const [name, value] of Object.entries({ DOMAIN: domain, PUBLIC_ORIGIN: `https://${domain}`, REPO_ANTI_ROT_DASHBOARD_URL: `https://${domain}` })) {
  const line = new RegExp(`^${name}=.*$`, "gm");
  content = line.test(content) ? content.replace(line, `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
}
// Replace only the three public settings; preserve every credential verbatim.
const temp = `${file}.domain-${process.pid}.tmp`;
await writeFile(temp, content, { mode: 0o600, flag: "wx" });
await rename(temp, file);
console.info(`Configured https://${domain}. Restart Compose with --env-file .env.local after DNS and ports are ready.`);
