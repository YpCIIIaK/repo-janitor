import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

try {
  await readFile(".env.local");
  console.info(".env.local already exists; preserved. See deploy/server.env.example for server settings.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  let template = await readFile("deploy/server.env.example", "utf8");
  template = template.replace(/=GENERATE_SECRET/g, () => `=${randomBytes(32).toString("hex")}`);
  await writeFile(".env.local", template, { flag: "wx", mode: 0o600 });
  console.info("Created .env.local with local secrets. Add GitHub/OpenRouter keys there; keys are never printed.");
}
