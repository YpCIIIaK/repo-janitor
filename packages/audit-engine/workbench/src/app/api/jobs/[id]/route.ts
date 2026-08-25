import { fail, ok, readJson } from "@/lib/http";
import { transitionJob, type JobAction } from "@/lib/jobControl";
import { abortJob, pumpRunner, runJobInBackground } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return fail("invalid job id");
  const body: { action?: JobAction } = await readJson<{ action?: JobAction }>(req).catch(() => ({}));
  if (!body.action || !["run", "cancel", "stop", "retry"].includes(body.action)) {
    return fail("action must be run, cancel, stop, or retry");
  }

  if (body.action === "run") {
    if (runJobInBackground(id, { force: true })) return ok({ id, action: "run", status: "running", started: true }, 202);
  }

  const result = transitionJob(id, body.action);
  if (!result.ok) {
    if (result.code === "not_found") return fail("job not found", 404);
    return fail(`cannot ${body.action} job in status ${result.status}`, 409);
  }
  if (body.action === "stop") abortJob(id);
  if (body.action === "run" || body.action === "retry") {
    const started = runJobInBackground(id, { force: true });
    if (!started) void pumpRunner();
    return ok({ id, action: body.action, status: started ? "running" : "queued", started }, started ? 202 : 200);
  }
  return ok({ id, action: body.action, status: result.status });
}
