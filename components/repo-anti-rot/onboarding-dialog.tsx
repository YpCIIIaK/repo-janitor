"use client"

import { useState } from "react"
import { Check, Copy, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const workflow = `# .github/workflows/hygiene.yml
name: Repo Anti-Rot
on:
  schedule: [{ cron: "0 9 * * 1" }]
  pull_request:
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: repo-anti-rot/action@v1
        with:
          dashboard-url: \${{ secrets.REPO_ANTI_ROT_URL }}
          dashboard-token: \${{ secrets.REPO_ANTI_ROT_TOKEN }}`

export function OnboardingDialog() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(workflow)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Plus className="size-4" />
          Add repo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
          <DialogDescription>
            Repo Anti-Rot runs inside your own GitHub Actions — no compute on our side. Drop
            this workflow into your repo and the first report lands here.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-secondary p-4 font-mono text-xs leading-relaxed text-muted-foreground">
            {workflow}
          </pre>
          <Button
            size="sm"
            variant="secondary"
            onClick={copy}
            className="absolute right-2 top-2 h-7 gap-1.5"
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
