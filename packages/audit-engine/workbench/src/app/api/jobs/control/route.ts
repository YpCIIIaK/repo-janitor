import { fail, ok, readJson } from "@/lib/http";
import { bulkTransition, setRunnerPaused } from "@/lib/jobControl";
import { abortAllRunning, pumpRunner, runnerState } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

type ControlAction = "pause" | "resume" | "stop_running" | "cancel_queued" | "retry_failed";

export async function POST(req: Request) {
  const body: { action?: ControlAction } = await readJson<{ action?: ControlAction }>(req).catch(() => ({}));
  const action = body.action;
  if (!action || !["pause", "resume", "stop_running", "cancel_queued", "retry_failed"].includes(action)) {
    return fail("action must be pause, resume, stop_running, cancel_queued, or retry_failed");
  }

  let affected: number[] = [];
  if (action === "pause") setRunnerPaused(true);
  if (action === "resume") {
    setRunnerPaused(false);
    void pumpRunner();
  }
  if (action === "stop_running") {
    affected = bulkTransition(action);
    abortAllRunning();
  }
  if (action === "cancel_queued" || action === "retry_failed") {
    affected = bulkTransition(action);
    if (action === "retry_failed" && !runnerState().paused) void pumpRunner();
  }
  return ok({ action, affected, count: affected.length, runner: runnerState() });
}
