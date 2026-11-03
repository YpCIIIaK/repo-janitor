import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Infrastructure-as-code security scanner.
 *
 * Reads Terraform, CloudFormation, Kubernetes manifests (Helm templates
 * included) and docker-compose files for the misconfigurations that turn into
 * breaches on their own, with no bug in the application:
 *
 *  - storage or databases reachable from the internet (public S3 ACLs, RDS
 *    `publicly_accessible`, security groups open to 0.0.0.0/0 on admin and
 *    database ports);
 *  - encryption switched off;
 *  - IAM policies granting every action on every resource;
 *  - passwords written into the configuration;
 *  - containers that can take over their host (privileged, host namespaces,
 *    the Docker socket, dangerous capabilities, privilege escalation).
 *
 * Text-based, like the Dockerfile scanner: each check is a line pattern plus,
 * where it matters, the few lines around it (a 0.0.0.0/0 rule is only reported
 * when the same block opens an admin or database port). Examples, tests and
 * docs are skipped: modules ship deliberately open examples.
 */

const TF_RE = /\.tf$/i
const YAML_RE = /\.ya?ml$/i
const JSON_RE = /\.json$/i
const COMPOSE_RE = /(^|\/)(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/i
const NOT_DEPLOYED_RE =
  /(^|\/)(?:_?examples?|samples?|demos?|tests?|testdata|test-fixtures|fixtures?|docs?|website|\.github|node_modules|vendor)\//i
const MAX_TOTAL = 60
const MAX_PER_FILE = 8

/** Ports that should never face the whole internet: SSH, RDP, databases, caches, search, Docker. */
const ADMIN_PORTS = new Set([22, 23, 3389, 5900, 3306, 5432, 1433, 1521, 27017, 6379, 11211, 9200, 9300, 2375, 2376, 5984, 8086])

interface IacRule {
  id: string
  severity: Severity
  title: string
  detail: string
}

const RULES: Record<string, IacRule> = {
  "public-bucket": {
    id: "public-bucket",
    severity: "critical",
    title: "Storage bucket is publicly readable",
    detail:
      "The bucket grants read (or write) access to everyone on the internet. Unless it hosts a public website on " +
      "purpose, keep it private and serve files through signed URLs or a CDN with an origin access control.",
  },
  "open-admin-port": {
    id: "open-admin-port",
    severity: "critical",
    title: "Admin or database port open to the whole internet",
    detail:
      "A security rule admits 0.0.0.0/0 on an SSH, RDP, database or cache port. Bots scan these ranges within " +
      "minutes. Restrict the source to a VPN, a bastion or known address ranges.",
  },
  "public-database": {
    id: "public-database",
    severity: "critical",
    title: "Database instance is publicly accessible",
    detail:
      "The managed database gets a public address. Keep it in private subnets and reach it through the " +
      "application or a bastion.",
  },
  unencrypted: {
    id: "unencrypted",
    severity: "warning",
    title: "Encryption at rest is switched off",
    detail:
      "Storage that holds data is explicitly left unencrypted. Turn encryption on (it is free on most providers " +
      "and transparent to the application).",
  },
  "iam-wildcard": {
    id: "iam-wildcard",
    severity: "critical",
    title: "IAM policy grants every action on every resource",
    detail:
      "`Action: *` on `Resource: *` is full administrator access. Grant only the actions and resources the role " +
      "needs; a leaked key for this role owns the whole account.",
  },
  "hardcoded-password": {
    id: "hardcoded-password",
    severity: "critical",
    title: "Password written into infrastructure code",
    detail:
      "A password is a literal in the configuration, so it lives in git history and every state file. Read it " +
      "from a secret store (AWS Secrets Manager, SSM, Vault) or a sensitive variable.",
  },
  privileged: {
    id: "privileged",
    severity: "critical",
    title: "Container runs privileged",
    detail:
      "A privileged container has every capability and the host's devices: escaping it is trivial. Grant only " +
      "the specific capabilities the workload needs.",
  },
  "host-namespace": {
    id: "host-namespace",
    severity: "warning",
    title: "Container shares the host's network or process namespace",
    detail:
      "hostNetwork/hostPID/hostIPC (or `network_mode: host`) lets the container see and talk to everything on the " +
      "node. Use regular pod networking unless the workload is a node agent that genuinely needs it.",
  },
  "docker-socket": {
    id: "docker-socket",
    severity: "warning",
    title: "Docker socket mounted into a container",
    detail:
      "Access to /var/run/docker.sock is root on the host: the container can start a privileged container of its " +
      "own. Mount it only into trusted infrastructure (a reverse proxy reading labels, a CI runner) and read-only.",
  },
  "privilege-escalation": {
    id: "privilege-escalation",
    severity: "warning",
    title: "Container allows privilege escalation",
    detail:
      "`allowPrivilegeEscalation: true` lets a process gain more privileges than its parent (setuid binaries). " +
      "Set it to false in the securityContext.",
  },
  "dangerous-capability": {
    id: "dangerous-capability",
    severity: "warning",
    title: "Container adds a dangerous Linux capability",
    detail:
      "SYS_ADMIN, NET_ADMIN, SYS_PTRACE or ALL each give a container enough power to break out of it or spy on " +
      "the host. Drop ALL and add back only what is needed.",
  },
  "run-as-root": {
    id: "run-as-root",
    severity: "info",
    title: "Container is configured to run as root",
    detail: "`runAsUser: 0` (or `runAsNonRoot: false`) runs the workload as root. Pick a non-zero user id.",
  },
}

interface Hit {
  rule: IacRule
  line: number
  evidence: string
}

const near = (lines: string[], i: number, before: number, after: number) =>
  lines.slice(Math.max(0, i - before), i + after + 1).join("\n")

/** Ports a block opens, from Terraform `from_port`/`to_port` or CloudFormation `FromPort`/`ToPort`. */
function portsIn(block: string): { from: number; to: number } | null {
  const from = block.match(/\b(?:from_port|FromPort)\b["']?\s*[:=]\s*["']?(-?\d+)/)
  const to = block.match(/\b(?:to_port|ToPort)\b["']?\s*[:=]\s*["']?(-?\d+)/)
  if (!from) return null
  const f = Number(from[1])
  return { from: f, to: to ? Number(to[1]) : f }
}

function opensAdminPort(block: string): boolean {
  if (/\bprotocol\b["']?\s*[:=]\s*["']?(?:-1|all)\b/i.test(block) && !portsIn(block)) return true
  const p = portsIn(block)
  if (!p) return false
  if (p.from <= 0 && (p.to <= 0 || p.to >= 65535)) return true // all ports
  for (const port of ADMIN_PORTS) if (port >= p.from && port <= p.to) return true
  return false
}

/** Terraform and CloudFormation (YAML or JSON) share most cloud checks. */
function cloudHits(lines: string[], isTerraform: boolean): Hit[] {
  const hits: Hit[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (/^(?:#|\/\/)/.test(t)) continue
    const push = (id: string) => hits.push({ rule: RULES[id], line: i + 1, evidence: t.slice(0, 160) })

    if (/\bacl\b\s*=\s*"public-read(?:-write)?"|AccessControl["']?\s*:\s*["']?PublicRead(?:Write)?\b/.test(line)) push("public-bucket")
    else if (/\b(?:block_public_acls|block_public_policy|restrict_public_buckets|ignore_public_acls)\s*=\s*false\b|\b(?:BlockPublicAcls|BlockPublicPolicy|RestrictPublicBuckets)["']?\s*:\s*["']?false\b/.test(line)) push("public-bucket")
    else if (/(?:"|\b)(?:0\.0\.0\.0\/0|::\/0)"/.test(line) || /CidrIp(?:v6)?["']?\s*:\s*["']?(?:0\.0\.0\.0\/0|::\/0)/.test(line)) {
      // Only an ingress rule matters, and only when it opens an admin/database port.
      const block = near(lines, i, 10, 10)
      const egress = /\begress\b|SecurityGroupEgress|type\s*=\s*"egress"/.test(near(lines, i, 6, 2)) && !/\bingress\b|SecurityGroupIngress/.test(near(lines, i, 6, 2))
      if (!egress && opensAdminPort(block)) push("open-admin-port")
    } else if (/\bpublicly_accessible\s*=\s*true\b|PubliclyAccessible["']?\s*:\s*["']?true\b/.test(line)) push("public-database")
    else if (/\b(?:encrypted|storage_encrypted|encrypt_at_rest|enable_encryption)\s*=\s*false\b|\b(?:Encrypted|StorageEncrypted|KmsEncrypted)["']?\s*:\s*["']?false\b/.test(line)) push("unencrypted")
    else if (/["']?Action["']?\s*:\s*\[?\s*["']\*["']|\bactions\s*=\s*\[\s*"\*"\s*\]/.test(line)) {
      const block = near(lines, i, 6, 6)
      const allResources = /["']?Resource["']?\s*:\s*\[?\s*["']\*["']|\bresources\s*=\s*\[\s*"\*"\s*\]/.test(block)
      const deny = /["']?Effect["']?\s*:\s*["']?Deny|\beffect\s*=\s*"Deny"/.test(block)
      if (allResources && !deny) push("iam-wildcard")
    } else if (
      isTerraform &&
      /^\s*(?:password|master_password|admin_password|db_password|root_password)\s*=\s*"[^"$]{6,}"/.test(line) &&
      !/"(?:changeme|password|example|xxx+|placeholder|<[^>]*>)"/i.test(line)
    ) push("hardcoded-password")
  }
  return hits
}

/** Kubernetes manifests (Helm templates included) and docker-compose services. */
function containerHits(lines: string[], compose: boolean): Hit[] {
  const hits: Hit[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (t.startsWith("#")) continue
    const push = (id: string) => hits.push({ rule: RULES[id], line: i + 1, evidence: t.slice(0, 160) })

    if (/^\s*privileged:\s*true\b/.test(line)) push("privileged")
    else if (/^\s*host(?:Network|PID|IPC):\s*true\b/.test(line) || (compose && /^\s*(?:network_mode|pid|ipc):\s*["']?host\b/.test(line))) push("host-namespace")
    else if (/\/var\/run\/docker\.sock/.test(line) && !/:ro\b|readOnly:\s*true/.test(near(lines, i, 0, 3))) push("docker-socket")
    else if (/^\s*allowPrivilegeEscalation:\s*true\b/.test(line)) push("privilege-escalation")
    else if (/^\s*(?:-\s*)?["']?(?:SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|ALL)["']?\s*$/.test(line) && /\badd:|cap_add:/.test(near(lines, i, 4, 0)) && !/\bdrop:/.test(near(lines, i, 1, 0))) push("dangerous-capability")
    else if (/^\s*runAsUser:\s*0\b|^\s*runAsNonRoot:\s*false\b|^\s*user:\s*["']?(?:root|0)(?::0)?["']?\s*$/.test(line)) push("run-as-root")
  }
  return hits
}

function isKubernetes(content: string): boolean {
  return /^\s*apiVersion:\s*\S+/m.test(content) && /^\s*kind:\s*\S+/m.test(content)
}

function isCloudFormation(content: string): boolean {
  return /AWSTemplateFormatVersion|["']?Type["']?\s*:\s*["']?AWS::/.test(content)
}

export const iacSecurityScanner: Scanner = {
  id: "iac-security",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (NOT_DEPLOYED_RE.test(norm)) continue
      const tf = TF_RE.test(norm)
      const yaml = YAML_RE.test(norm)
      const json = JSON_RE.test(norm)
      if (!tf && !yaml && !json) continue
      // JSON is only CloudFormation; skip package manifests and the like quickly.
      if (json && /(^|\/)(?:package|tsconfig|composer|\.?eslintrc|renovate|turbo|lerna)[\w.-]*\.json$/i.test(norm)) continue

      const content = await ctx.readFile(file)
      if (!content || content.length > 512 * 1024) continue

      const lines = content.split(/\r?\n/)
      let hits: Hit[] = []
      if (tf) hits = cloudHits(lines, true)
      else if (isCloudFormation(content)) hits = cloudHits(lines, false)
      else if (yaml && COMPOSE_RE.test(norm)) hits = containerHits(lines, true)
      else if (yaml && (isKubernetes(content) || /(^|\/)templates\//.test(norm))) hits = containerHits(lines, false)
      else continue

      for (const hit of hits.slice(0, MAX_PER_FILE)) {
        if (issues.length >= MAX_TOTAL) break
        issues.push({
          id: `iac-${hit.rule.id}-${norm}:${hit.line}`,
          category: "security",
          severity: hit.rule.severity,
          title: hit.rule.title,
          location: `${norm}:${hit.line}`,
          ageDays: 0,
          detail: hit.rule.detail,
          evidence: hit.rule.id === "hardcoded-password" ? hit.evidence.replace(/"[^"]*"/, '"••••••"') : hit.evidence,
        })
      }
    }

    return issues
  },
}
