import { describe, it, expect } from "vitest"
import { iacSecurityScanner } from "../../src/index"
import { makeContext } from "../helpers"

const rules = async (files: Record<string, string>) =>
  (await iacSecurityScanner.run(makeContext({ files }))).map((i) => i.id.replace(/-[^-]*:\d+$/, "").replace(/^(iac-[a-z-]+?)-[\w./-]*$/, "$1"))

const ids = async (files: Record<string, string>) => (await iacSecurityScanner.run(makeContext({ files }))).map((i) => i.id)

describe("iac-security — Terraform (terragoat-style)", () => {
  it("flags a public bucket, SSH open to the world, a public database, no encryption and *:*", async () => {
    const out = await ids({
      "s3.tf": 'resource "aws_s3_bucket_acl" "data" {\n  bucket = aws_s3_bucket.data.id\n  acl    = "public-read"\n}\n',
      "sg.tf":
        'resource "aws_security_group" "web" {\n  ingress {\n    from_port   = 22\n    to_port     = 22\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n',
      "db.tf": 'resource "aws_db_instance" "db" {\n  publicly_accessible = true\n  storage_encrypted   = false\n  password            = "Aa1234567890"\n}\n',
      "iam.tf":
        'data "aws_iam_policy_document" "admin" {\n  statement {\n    effect    = "Allow"\n    actions   = ["*"]\n    resources = ["*"]\n  }\n}\n',
    })
    expect(out.map((i) => i.split("-").slice(0, 3).join("-"))).toEqual(
      expect.arrayContaining(["iac-public-bucket", "iac-open-admin", "iac-public-database", "iac-unencrypted-db.tf:3", "iac-iam-wildcard", "iac-hardcoded-password"]),
    )
  })

  it("leaves HTTPS open to the world, egress, Deny statements and examples alone", async () => {
    const out = await ids({
      "lb.tf":
        'resource "aws_security_group" "lb" {\n  ingress {\n    from_port   = 443\n    to_port     = 443\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n  egress {\n    from_port   = 0\n    to_port     = 0\n    protocol    = "-1"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n',
      "deny.tf": 'statement {\n  effect    = "Deny"\n  actions   = ["*"]\n  resources = ["*"]\n}\n',
      "examples/complete/main.tf": 'acl = "public-read"\n',
      "vars.tf": 'variable "db_password" {\n  sensitive = true\n}\npassword = var.db_password\n',
    })
    expect(out).toEqual([])
  })
})

describe("iac-security — Kubernetes and docker-compose", () => {
  it("flags privileged pods, host namespaces, the Docker socket and SYS_ADMIN", async () => {
    const out = await ids({
      "k8s/deploy.yaml":
        "apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      hostNetwork: true\n      containers:\n" +
        "        - name: app\n          securityContext:\n            privileged: true\n            allowPrivilegeEscalation: true\n" +
        "            capabilities:\n              add:\n                - SYS_ADMIN\n      volumes:\n        - name: sock\n" +
        "          hostPath:\n            path: /var/run/docker.sock\n",
    })
    const kinds = out.map((i) => i.replace(/^iac-/, "").replace(/-k8s\/.*$/, ""))
    expect(kinds.sort()).toEqual(["dangerous-capability", "docker-socket", "host-namespace", "privilege-escalation", "privileged"])
  })

  it("accepts a read-only Docker socket in compose and dropped capabilities", async () => {
    const out = await ids({
      "docker-compose.yml":
        "services:\n  traefik:\n    image: traefik:v3\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock:ro\n    cap_drop:\n      - ALL\n",
    })
    expect(out).toEqual([])
  })

  it("ignores YAML that is not a manifest", async () => {
    expect(await rules({ "config/app.yml": "privileged: true\n" })).toEqual([])
  })
})

describe("iac false-positive clusters (benchmark batch 12–15)", () => {
  it("ignores deny-only and ICMP-only rules open to the world", async () => {
    const out = await ids({
      "fw.tf": 'resource "google_compute_firewall" "deny" {\n  deny {\n    protocol = "all"\n  }\n  source_ranges = ["0.0.0.0/0"]\n}\n',
      "sg.tf": 'resource "aws_security_group" "ping" {\n  ingress {\n    from_port   = -1\n    to_port     = -1\n    protocol    = "icmp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}\n',
    })
    expect(out.filter((i) => i.startsWith("iac-open-admin-port"))).toEqual([])
  })
  it("ignores the docker socket on services built to talk to Docker", async () => {
    const out = await ids({
      "docker-compose.yml": "services:\n  proxy:\n    image: traefik:v3.1\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n  app:\n    image: myapp:1\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
    })
    expect(out.filter((i) => i.startsWith("iac-docker-socket"))).toHaveLength(1)
  })
})

describe("iac monitoring agents (benchmark batch 12–15)", () => {
  it("leaves cadvisor and node-exporter host access alone", async () => {
    const out = await ids({
      "docker-compose.exporters.yml": "services:\n  nodeexporter:\n    image: prom/node-exporter:v1.8.0\n    network_mode: host\n  cadvisor:\n    image: gcr.io/cadvisor/cadvisor:v0.49.1\n    privileged: true\n  app:\n    image: myapp:1\n    privileged: true\n",
    })
    expect(out.filter((i) => i.startsWith("iac-"))).toHaveLength(1)
  })
})


describe("Docker API image names from pinned socket reviews", () => {
  it("accepts Portainer CE command and mount and lazydocker's required mount", async () => {
    // docker/awesome-compose@30f4b7f portainer/compose.yaml:3-9;
    // jesseduffield/lazydocker@7e7aadc docker-compose.yml:9-14.
    const out = await ids({
      "portainer/compose.yaml": 'services:\n  portainer:\n    image: portainer/portainer-ce:alpine\n    command: -H unix:///var/run/docker.sock\n    volumes:\n      - "/var/run/docker.sock:/var/run/docker.sock"\n',
      "docker-compose.yml": 'services:\n  lazydocker:\n    image: lazyteam/lazydocker\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n',
    })
    expect(out.filter(i => i.startsWith("iac-docker-socket"))).toEqual([])
  })

  it.each(["myapp:1", "my-portainer-ce:1", "portainer-ce-helper:1", "lazydocker-app:1", "notlazydocker:1"])("still flags application socket mounts for %s", async image => {
    const out = await ids({
      "compose.yaml": `services:\n  app:\n    image: ${image}\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n`,
    })
    expect(out.filter(i => i.startsWith("iac-docker-socket"))).toHaveLength(1)
  })
})

// OCI uses ingress_security_rules/egress_security_rules rather than AWS ingress/egress.
describe("OCI security-list traffic direction", () => {
  it.each([false, true])("reports ingress but never adjacent egress (egress first: %s)", async egressFirst => {
    const ingress = '  ingress_security_rules {\n    protocol = "all"\n    source = "0.0.0.0/0"\n  }\n'
    const egress = '  egress_security_rules {\n    protocol = "all"\n    destination = "0.0.0.0/0"\n  }\n'
    const source = 'resource "oci_core_default_security_list" "web" {\n' + (egressFirst ? egress + ingress : ingress + egress) + '}\n'
    const out = (await iacSecurityScanner.run(makeContext({files: {"network.tf": source}})))
      .filter(i => i.id.startsWith("iac-open-admin-port"))
    expect(out.map(i => i.location)).toEqual([`network.tf:${egressFirst ? 8 : 4}`])
  })

  it("does not hide unrestricted OCI ingress when egress is restricted", async () => {
    const out = await ids({"network.tf": 'resource "oci_core_security_list" "web" {\n  egress_security_rules {\n    protocol = "all"\n    destination = "10.0.0.0/8"\n  }\n  ingress_security_rules {\n    protocol = "all"\n    source = "::/0"\n  }\n}\n'})
    expect(out.filter(i => i.startsWith("iac-open-admin-port"))).toEqual(["iac-open-admin-port-network.tf:8"])
  })
})
