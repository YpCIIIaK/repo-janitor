/**
 * Environment variable lookup with legacy-name fallback.
 *
 * The project shipped two prefixes for the same thing — `REPO_ANTI_ROT_*` for
 * scan limits and API tokens, `RAR_*` for the AI proxy and the webhook. Nobody
 * can guess which applies to which setting; you have to read the source. The
 * canonical prefix is now `REPO_ANTI_ROT_` everywhere.
 *
 * The old names keep working. Renaming an environment variable is a silent
 * break: the deployment does not fail, the feature just quietly stops — a
 * webhook that no longer fires looks exactly like a repo whose score never
 * dropped. Reading both costs one function.
 */

/** Old `RAR_*` name → current `REPO_ANTI_ROT_*` name. */
export const LEGACY_ENV_ALIASES: Record<string, string> = {
  REPO_ANTI_ROT_AI_PROXY_TOKEN: "RAR_AI_PROXY_TOKEN",
  REPO_ANTI_ROT_WEBHOOK_URL: "RAR_WEBHOOK_URL",
  REPO_ANTI_ROT_WEBHOOK_MIN_DROP: "RAR_WEBHOOK_MIN_DROP",
  REPO_ANTI_ROT_DASHBOARD_URL: "RAR_DASHBOARD_URL",
}

/**
 * Read `name`, falling back to its deprecated alias. Returns `undefined` when
 * neither is set — callers distinguish "unset" from "empty" themselves, since
 * an empty token should not read as "auth disabled".
 */
export function readEnv(name: string): string | undefined {
  const direct = process.env[name]
  if (direct !== undefined) return direct
  const legacy = LEGACY_ENV_ALIASES[name]
  return legacy ? process.env[legacy] : undefined
}
