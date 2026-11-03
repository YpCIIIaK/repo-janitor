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
