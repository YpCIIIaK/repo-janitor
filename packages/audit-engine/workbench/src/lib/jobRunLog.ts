import fs from "node:fs";
import path from "node:path";

import { bountyRoot } from "./paths";

export function safeRunSegment(value: string, fallback: string): string {
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return clean.slice(0, 100) || fallback;
}

export class JobRunLog {
  readonly runId: string;
  private readonly file: string;
  private seq = 0;
  private readonly started = Date.now();
  private activeStep: "fetch_hp" | "fetch_github" | "model" | "persist" | null = null;
  private stepStarted = 0;

  constructor(readonly slug: string, readonly jobId: number) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    this.runId = `${stamp}-${randomPart()}-summarize`;
    const safeSlug = safeRunSegment(slug, `job-${jobId}`);
    const root = path.resolve(bountyRoot());
    const dir = path.resolve(root, safeSlug, "runs");
    if (!dir.startsWith(root + path.sep)) throw new Error("invalid run path");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${this.runId}.jsonl`);
  }

  emit(kind: string, data: Record<string, unknown> = {}) {
    const event = {
      ts: new Date().toISOString(),
      seq: ++this.seq,
      run: this.runId,
      slug: safeRunSegment(this.slug, `job-${this.jobId}`),
      kind,
      job_id: this.jobId,
      ...data,
    };
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
  }

  stepStart(step: "fetch_hp" | "fetch_github" | "model" | "persist") {
    this.activeStep = step;
    this.stepStarted = Date.now();
    this.emit("step_start", { name: step, step });
  }

  stepEnd(step: "fetch_hp" | "fetch_github" | "model" | "persist", status: "ok" | "err", data = {}) {
    this.emit("step_end", { name: step, step, status, ms: Math.max(0, Date.now() - this.stepStarted), ...data });
    if (this.activeStep === step) this.activeStep = null;
  }

  failActive(error: string, stopped = false) {
    if (!this.activeStep) return;
    this.stepEnd(this.activeStep, "err", { error: error.slice(0, 500), stopped });
  }

  end(status: "ok" | "err" | "stopped", data: Record<string, unknown> = {}) {
    this.emit("run_end", { status, ms: Date.now() - this.started, ...data });
  }
}

function randomPart() {
  return Math.random().toString(36).slice(2, 8);
}
