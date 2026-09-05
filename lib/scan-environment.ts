/** Scans must never inherit database, OAuth, AI or operator credentials. */
export function scanEnvironment(source: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "lang", "lc_all", "ssl_cert_file", "ssl_cert_dir", "node_extra_ca_certs"])
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key.toLowerCase()) && value !== undefined) env[key] = value
  }
  return {
    ...env,
    NODE_ENV: "production",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "http.followRedirects", GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "protocol.file.allow", GIT_CONFIG_VALUE_1: "never",
    GIT_CONFIG_KEY_2: "protocol.ext.allow", GIT_CONFIG_VALUE_2: "never",
    GIT_CONFIG_KEY_3: "core.hooksPath", GIT_CONFIG_VALUE_3: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_LFS_SKIP_SMUDGE: "1",
  }
}
