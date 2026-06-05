"use client"

import { useEffect, useState } from "react"
import { Settings, Sparkles, Eye, EyeOff, Check, Clock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  ALL_CATEGORIES,
  MODEL_PRESETS,
  readAiSettings,
  saveAiSettings,
  type AiSettings,
} from "@/lib/ai-settings"
import { categoryLabels } from "@/lib/mock-data"
import {
  readSchedule,
  saveSchedule,
  describeSchedule,
  MIN_INTERVAL_HOURS,
  type ScheduleSettings,
} from "@/lib/schedule-store"

const CATEGORY_HINT: Record<string, string> = {
  "dead-code": "Is each unused export really safe to remove?",
  env: "Required vs optional env var, and what to document.",
  dependency: "Safe to drop/replace a dependency, and the risk.",
  branch: "Delete, merge, or keep a stale branch.",
  todo: "Is the TODO still actionable or stale?",
  secret: "Live credential vs placeholder + remediation (redacted input).",
  hygiene: "Missing files, tests/CI, debug logs, docs — the concrete fix.",
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AiSettings>(readAiSettings)
  const [sched, setSched] = useState<ScheduleSettings>(readSchedule)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  // Re-sync the draft from storage whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      setDraft(readAiSettings())
      setSched(readSchedule())
      setShowKey(false)
      setSaved(false)
    }
  }, [open])

  function save() {
    saveAiSettings(draft)
    saveSchedule(sched)
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setOpen(false)
    }, 700)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" title="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure AI analysis and scheduled scans. Everything is stored only in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 py-2">
          {/* AI analysis */}
          <div className="space-y-0.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              AI analysis
            </h3>
            <p className="text-xs text-muted-foreground">
              Connect OpenRouter to enrich findings with an AI assessment. Your key is sent through
              our own server — never directly to a third party.
            </p>
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <Label htmlFor="ai-key">OpenRouter API key</Label>
            <div className="relative">
              <Input
                id="ai-key"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-or-v1-…"
                className="pr-9 font-mono text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={showKey ? "Hide" : "Show"}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get one at{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          </div>

          {/* Model id */}
          <div className="space-y-1.5">
            <Label htmlFor="ai-model">Model id</Label>
            <Input
              id="ai-model"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="vendor/model-id"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {MODEL_PRESETS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, model: m.id })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    draft.model === m.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title={m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Paste any OpenRouter model id, or pick a preset above.
            </p>
          </div>

          {/* Per-category toggles */}
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label>Analyze these categories on scan</Label>
              <p className="text-xs text-muted-foreground">
                After each scan, findings in the enabled categories get an AI verdict. Only the
                finding's title, location and (redacted) snippet are sent.
              </p>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {ALL_CATEGORIES.map((cat) => (
                <div key={cat} className="flex items-start justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={`ai-cat-${cat}`} className="cursor-pointer">
                      {categoryLabels[cat]}
                    </Label>
                    <p className="text-xs text-muted-foreground">{CATEGORY_HINT[cat]}</p>
                  </div>
                  <Switch
                    id={`ai-cat-${cat}`}
                    checked={draft.categories[cat]}
                    onCheckedChange={(v) =>
                      setDraft((d) => ({ ...d, categories: { ...d.categories, [cat]: v } }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scheduled scans */}
          <div className="space-y-2 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="sched-enabled" className="flex items-center gap-1.5">
                  <Clock className="size-4 text-primary" />
                  Scheduled scans
                </Label>
                <p className="text-xs text-muted-foreground">
                  Auto-rescan tracked repos on a schedule while this tab is open.
                </p>
              </div>
              <Switch
                id="sched-enabled"
                checked={sched.enabled}
                onCheckedChange={(v) => setSched((s) => ({ ...s, enabled: v }))}
              />
            </div>

            {sched.enabled && (
              <div className="space-y-3 rounded-md border border-border p-3">
                {/* Mode toggle */}
                <div className="flex gap-1.5">
                  {(["interval", "daily"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSched((s) => ({ ...s, mode: m }))}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        sched.mode === m
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {m === "interval" ? "Every N hours" : "Daily at time"}
                    </button>
                  ))}
                </div>

                {sched.mode === "interval" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="sched-hours">Hours between scans (per repo)</Label>
                    <Input
                      id="sched-hours"
                      type="number"
                      min={MIN_INTERVAL_HOURS}
                      step={0.25}
                      value={sched.intervalHours}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value)
                        setSched((s) => ({ ...s, intervalHours: Number.isFinite(n) ? n : s.intervalHours }))
                      }}
                      onBlur={() =>
                        setSched((s) => ({ ...s, intervalHours: Math.max(MIN_INTERVAL_HOURS, s.intervalHours) }))
                      }
                      className="w-28 text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="sched-time">Local time of day</Label>
                    <Input
                      id="sched-time"
                      type="time"
                      value={sched.dailyTime}
                      onChange={(e) => setSched((s) => ({ ...s, dailyTime: e.target.value }))}
                      className="w-32 text-sm"
                    />
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {describeSchedule(sched)} · runs only while a tab is open. For unattended scans use
                  the GitHub Action&apos;s <code>schedule:</code> trigger.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>
            {saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
