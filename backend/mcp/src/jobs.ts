/**
 * Video exports in the cloud: an HTTP request can't keep working after its
 * response, so a job is a Cloud Tasks task handled by the `mcpExport`
 * function; its status lives in users/{uid}/mcpJobs/{jobId}.
 */
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import type { JobRunner, JobSpec, JobStatus } from '../../../packages/mcp/src/jobs.ts';

export const REGION = 'asia-south1';
export const EXPORT_FUNCTION = 'mcpExport';

export interface ExportTask { uid: string; jobId: string; spec: JobSpec }

export const jobDoc = (db: Firestore, uid: string, id: string) => db.collection('users').doc(uid).collection('mcpJobs').doc(id);

export class TaskQueueJobs implements JobRunner {
  constructor(private db: Firestore, private uid: string) {}

  async start(spec: JobSpec): Promise<string> {
    const id = `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    await jobDoc(this.db, this.uid, id).set({ id, state: 'queued', progress: 0, spec, createdAt: FieldValue.serverTimestamp(), ttl: Timestamp.fromMillis(Date.now() + 7 * 86400e3) });
    const task: ExportTask = { uid: this.uid, jobId: id, spec };
    await getFunctions().taskQueue(`locations/${REGION}/functions/${EXPORT_FUNCTION}`).enqueue(task, { dispatchDeadlineSeconds: 1800 });
    return id;
  }

  async status(id: string): Promise<JobStatus | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    const s = await jobDoc(this.db, this.uid, id).get();
    if (!s.exists) return null;
    const d = s.data()!;
    return { id, state: d.state, ...(d.progress !== undefined ? { progress: d.progress } : {}), ...(d.result ? { result: d.result } : {}), ...(d.error ? { error: d.error } : {}) };
  }
}
