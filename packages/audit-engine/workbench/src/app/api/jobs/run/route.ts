import { fail, ok, readJson } from "@/lib/http";
import { configureRunner, pumpRunner, runJobInBackground, runnerState } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body: { jobId?: number; pause?: boolean; capacity?: number } =
    await readJson<{ jobId?: number; pause?: boolean; capacity?: number }>(req).catch(() => ({}));
  if (body.pause !== undefined && typeof body.pause !== "boolean") return fail("pause must be boolean");
  if (body.capacity !== undefined &&
      (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 8)) {
    return fail("capacity must be an integer from 1 to 8");
  }
  configureRunner({ pause: body.pause, capacity: body.capacity });
  let started: boolean | undefined;
  if (body.jobId !== undefined) {
    if (!Number.isInteger(body.jobId) || body.jobId <= 0) return fail("jobId must be a positive integer");
    started = runJobInBackground(body.jobId);
    if (!started) return fail("job is not queued or runner has no capacity", 409);
  } else if (body.pause !== true) {
    void pumpRunner();
  }
  return ok({ started, runner: runnerState() }, started ? 202 : 200);
}
