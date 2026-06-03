"use client"

import { useState } from "react"
import { Activity, GitBranch, KeyRound, Boxes, ScanLine, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScanRunner } from "./scan-runner"

const features = [
  {
    icon: KeyRound,
    title: "Secrets & env drift",
    body: "Finds leaked keys in history and env vars referenced but missing from your example file.",
  },
  {
    icon: Boxes,
    title: "Dead weight",
    body: "Surfaces unused dependencies, dead exports and TODO debt that quietly rot the codebase.",
  },
  {
    icon: GitBranch,
    title: "Stale branches",
    body: "Flags abandoned branches and decay trends so you know exactly what to prune.",
  },
]

export function WelcomeScreen() {
  const [scanning, setScanning] = useState(false)

  if (scanning) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setScanning(false)}
          className="mb-6 text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <div className="mb-6">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">Run your first scan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a public repository URL — Repo Anti-Rot clones it and grades its health.
          </p>
        </div>
        <ScanRunner />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16 text-center md:py-24">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Activity className="size-8" />
      </div>

      <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight">
        Welcome to Repo Anti-Rot
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
        No repositories scanned yet. Point Repo Anti-Rot at any public git repo and it will measure the
        decay — secrets, stale branches, dead code and dependency rot — then hand you a health grade.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={() => setScanning(true)}>
          <ScanLine className="size-4" />
          Run your first scan
        </Button>
      </div>

      <div className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-card/40 p-4">
            <f.icon className="size-5 text-primary" />
            <p className="mt-3 text-sm font-medium">{f.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
