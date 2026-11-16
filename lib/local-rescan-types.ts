export interface LocalTarget { name: string; url: string; sha: string; scanned?: boolean }
export interface LocalTask {
  name: string; status: string; startedAt?: string; finishedAt?: string
  attempts?: number; error?: string; findings?: number
}
export interface LocalRun {
  id: string; status: string; createdAt: string; updatedAt: string; startedAt?: string
  total: number; done: number; failed: number; pending: number; freeGiB?: number; activeMs?: number
  active: LocalTask[]; recent: LocalTask[]; errors: LocalTask[]
  error?: string; fingerprint?: string; resultsPath: string
  config: { mode: string; jobs: number; refreshMetadata: boolean }
}
