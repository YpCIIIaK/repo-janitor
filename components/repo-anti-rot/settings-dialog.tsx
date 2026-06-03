"use client"

import { useEffect, useState } from "react"
import { Settings, Sparkles, Eye, EyeOff, Check } from "lucide-react"
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

const CATEGORY_HINT: Record<string, string> = {
  "dead-code": "Is each unused export really safe to remove?",
  env: "Required vs optional env var, and what to document.",
  dependency: "Safe to drop/replace a dependency, and the risk.",
  branch: "Delete, merge, or keep a stale branch.",
  todo: "Is the TODO still actionable or stale?",
  secret: "Live credential vs placeholder + remediation (redacted input).",
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AiSettings>(readAiSettings)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  // Re-sync the draft from storage whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      setDraft(readAiSettings())
      setShowKey(false)
      setSaved(false)
    }
  }, [open])

  function save() {
    saveAiSettings(draft)
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
            <Sparkles className="size-4 text-primary" />
            AI analysis
          </DialogTitle>
          <DialogDescription>
            Connect OpenRouter to enrich findings with an AI assessment. Your key is stored only in
            this browser and sent through our own server — never directly to a third party.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 py-2">
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
