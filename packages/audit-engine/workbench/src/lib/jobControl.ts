import { randomUUID } from "node:crypto";

import { db, getSetting, setSetting } from "./db";

export const JOB_STATUSES = ["queued", "running", "done", "error", "canceled", "stopped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobAction = "run" | "cancel" | "stop" | "retry";

export type TransitionResult =
  | { ok: true; id: number; status: JobStatus; previous: JobStatus }
  | { ok: false; code: "not_found" | "invalid_transition"; status?: string };

export function transitionJob(id: number, action: JobAction): TransitionResult {
  const row = db().prepare("SELECT status FROM jobs WHERE id=?").get(id) as { status: string } | undefined;
  if (!row) return { ok: false, code: "not_found" };
  const previous = row.status as JobStatus;
  let result;
  let status: JobStatus;
  if (action === "run") {
    status = "queued";
    result = db().prepare(
      `UPDATE jobs SET status='queued', error='', stop_requested_at=NULL, canceled_at=NULL,
       worker_token=NULL, run_id=NULL, report_id=NULL, started_at=NULL, finished_at=NULL
       WHERE id=? AND status IN ('error','stopped','canceled')`
    ).run(id);
  } else if (action === "retry") {
    status = "queued";
    result = db().prepare(
      `UPDATE jobs SET status='queued', error='', stop_requested_at=NULL, canceled_at=NULL,
       worker_token=NULL, run_id=NULL, report_id=NULL, started_at=NULL, finished_at=NULL
       WHERE id=? AND status IN ('error','stopped','canceled')`
    ).run(id);
  } else if (action === "cancel") {
    status = "canceled";
    result = db().prepare(
      `UPDATE jobs SET status='canceled', canceled_at=datetime('now'), finished_at=datetime('now')
       WHERE id=? AND status='queued'`
    ).run(id);
  } else {
    status = "running";
    result = db().prepare(
      `UPDATE jobs SET stop_requested_at=COALESCE(stop_requested_at, datetime('now'))
       WHERE id=? AND status='running'`
    ).run(id);
  }
  if (!result.changes) return { ok: false, code: "invalid_transition", status: previous };
  return { ok: true, id, status, previous };
}

export function bulkTransition(action: "stop_running" | "cancel_queued" | "retry_failed") {
  if (action === "stop_running") {
    const rows = db().prepare("SELECT id FROM jobs WHERE status='running'").all() as { id: number }[];
    db().prepare(
      `UPDATE jobs SET stop_requested_at=COALESCE(stop_requested_at, datetime('now')) WHERE status='running'`
    ).run();
    return rows.map((row) => row.id);
  }
  if (action === "cancel_queued") {
    const rows = db().prepare("SELECT id FROM jobs WHERE status='queued'").all() as { id: number }[];
    db().prepare(
      `UPDATE jobs SET status='canceled', canceled_at=datetime('now'), finished_at=datetime('now')
       WHERE status='queued'`
    ).run();
    return rows.map((row) => row.id);
  }
  const rows = db().prepare("SELECT id FROM jobs WHERE status IN ('error','stopped','canceled')").all() as { id: number }[];
  db().prepare(
    `UPDATE jobs SET status='queued', error='', stop_requested_at=NULL, canceled_at=NULL,
     worker_token=NULL, run_id=NULL, report_id=NULL, started_at=NULL, finished_at=NULL
     WHERE status IN ('error','stopped','canceled')`
  ).run();
  return rows.map((row) => row.id);
}

export function claimJob(jobId?: number, target?: string) {
  const picked = jobId
    ? db().prepare("SELECT * FROM jobs WHERE id=? AND status='queued'").get(jobId)
    : target
      ? db().prepare("SELECT * FROM jobs WHERE target=? AND status='queued' ORDER BY id DESC LIMIT 1").get(target)
      : db().prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY id ASC LIMIT 1").get();
  if (!picked) return undefined;
  const job = picked as Record<string, unknown>;
  const token = randomUUID();
  const claimed = db().prepare(
    `UPDATE jobs SET status='running', started_at=datetime('now'), finished_at=NULL, error='',
     stop_requested_at=NULL, canceled_at=NULL, worker_token=?, attempt=attempt+1
     WHERE id=? AND status='queued'`
  ).run(token, Number(job.id));
  if (!claimed.changes) return undefined;
  return db().prepare("SELECT * FROM jobs WHERE id=?").get(Number(job.id)) as Record<string, unknown>;
}

export function runnerPaused() {
  return getSetting("job_runner_paused", "0") === "1";
}

export function setRunnerPaused(paused: boolean) {
  setSetting("job_runner_paused", paused ? "1" : "0");
}

export function runnerCapacity() {
  const parsed = Number(getSetting("job_runner_capacity", "2"));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 2;
}

export function setRunnerCapacity(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new Error("capacity must be 1..8");
  setSetting("job_runner_capacity", String(capacity));
}
