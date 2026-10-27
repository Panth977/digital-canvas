/**
 * Long exports (video) run as jobs: the tool waits a while and returns the
 * result if it is done, else a job id the agent polls with get_export.
 *
 * Locally jobs run in this process. The Cloud Function plugs in a runner that
 * hands the job to a task queue (see backend/mcp) because an HTTP request can't
 * outlive its response there.
 */
import type { ExportResult } from './workspace.ts';

export interface VideoJobSpec {
  kind: 'video';
  designId: string;
  fps?: number;
  maxSide?: number;
  /** File name in Exports (without extension). */
  name?: string;
}

export type JobSpec = VideoJobSpec;

export interface JobStatus {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  /** 0..1 */
  progress?: number;
  result?: ExportResult;
  error?: string;
}

export interface JobRunner {
  start(spec: JobSpec, run: (onProgress: (p: number) => void) => Promise<ExportResult>): Promise<string>;
  status(id: string): Promise<JobStatus | null>;
}

/** Runs jobs in this process (stdio server, tests). Keeps the last 50. */
export class LocalJobs implements JobRunner {
  private jobs = new Map<string, JobStatus>();
  private n = 0;

  async start(_spec: JobSpec, run: (onProgress: (p: number) => void) => Promise<ExportResult>): Promise<string> {
    const id = `job_${Date.now().toString(36)}_${++this.n}`;
    const st: JobStatus = { id, state: 'running', progress: 0 };
    this.jobs.set(id, st);
    if (this.jobs.size > 50) this.jobs.delete(this.jobs.keys().next().value!);
    run((p) => { st.progress = Math.round(p * 100) / 100; })
      .then((result) => { st.state = 'done'; st.progress = 1; st.result = result; })
      .catch((e: unknown) => { st.state = 'failed'; st.error = e instanceof Error ? e.message : String(e); });
    return id;
  }

  async status(id: string): Promise<JobStatus | null> {
    const s = this.jobs.get(id);
    return s ? { ...s } : null;
  }
}

/** Poll until the job is done or `ms` passed. */
export async function waitFor(jobs: JobRunner, id: string, ms: number): Promise<JobStatus | null> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await jobs.status(id);
    if (!s || s.state === 'done' || s.state === 'failed' || Date.now() >= end) return s;
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, end - Date.now()))));
  }
}
