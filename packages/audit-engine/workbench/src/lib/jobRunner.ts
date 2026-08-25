import { db } from "./db";
import { runnerCapacity, runnerPaused, setRunnerCapacity, setRunnerPaused } from "./jobControl";
import { processNextJob } from "./pipeline";

type Registry = {
  controllers: Map<number, AbortController>;
  pumping: boolean;
};

const globalRegistry = globalThis as typeof globalThis & { __auditScoutJobRunner?: Registry };
const registry = globalRegistry.__auditScoutJobRunner ??= {
  controllers: new Map(),
  pumping: false,
};

export function runnerState() {
  const databaseRunning = db().prepare("SELECT id FROM jobs WHERE status='running' ORDER BY id").all() as { id: number }[];
  return {
    paused: runnerPaused(),
    capacity: runnerCapacity(),
    active: [...registry.controllers.keys()],
    running: databaseRunning.map((row) => row.id),
    available: Math.max(0, runnerCapacity() - registry.controllers.size),
  };
}

export function configureRunner(options: { pause?: boolean; capacity?: number }) {
  if (options.pause !== undefined) setRunnerPaused(options.pause);
  if (options.capacity !== undefined) setRunnerCapacity(options.capacity);
  return runnerState();
}

export function runJobInBackground(jobId: number, options: { force?: boolean } = {}) {
  if (!Number.isInteger(jobId) || jobId <= 0) return false;
  if ((!options.force && runnerPaused()) || registry.controllers.size >= runnerCapacity() || registry.controllers.has(jobId)) return false;
  const queued = db().prepare("SELECT id FROM jobs WHERE id=? AND status='queued'").get(jobId);
  if (!queued) return false;
  launch(jobId);
  return true;
}

export function abortJob(jobId: number) {
  const controller = registry.controllers.get(jobId);
  if (!controller) return false;
  controller.abort(new Error("job stop requested"));
  return true;
}

export function abortAllRunning() {
  const ids = [...registry.controllers.keys()];
  for (const id of ids) registry.controllers.get(id)?.abort(new Error("runner stop requested"));
  return ids;
}

export async function pumpRunner() {
  if (registry.pumping || runnerPaused()) return;
  registry.pumping = true;
  try {
    while (!runnerPaused() && registry.controllers.size < runnerCapacity()) {
      const slots = runnerCapacity() - registry.controllers.size;
      const rows = db().prepare(
        `SELECT id FROM jobs WHERE status='queued' ORDER BY id ASC LIMIT ?`
      ).all(slots) as { id: number }[];
      const available = rows.filter((row) => !registry.controllers.has(row.id));
      if (!available.length) break;
      for (const row of available) launch(row.id);
    }
  } finally {
    registry.pumping = false;
  }
}

function launch(jobId: number) {
  const controller = new AbortController();
  registry.controllers.set(jobId, controller);
  void processNextJob({ jobId, signal: controller.signal }).finally(() => {
    if (registry.controllers.get(jobId) === controller) registry.controllers.delete(jobId);
    void pumpRunner();
  });
}
