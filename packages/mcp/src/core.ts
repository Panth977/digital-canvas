/**
 * The platform-neutral tool core: runs in Node and in a browser (the device
 * worker). Nothing here imports node:* modules; set a platform first
 * (`setPlatform`), Node entry points do it on import.
 */
export { createServer, runJob, VERSION } from './server.ts';
export { Context, ToolError, DEFAULT_EDITOR_URL, type ServerOptions, type MediaRef } from './context.ts';
export { DriveWorkspace, MemoryAssetCache, type Workspace, type AssetInfo, type DriveHit, type ExportResult } from './workspace.ts';
export { LocalJobs, waitFor, type JobRunner, type JobSpec, type JobStatus } from './jobs.ts';
export { checkDesign, contrast, type Issue, type CheckResult } from './check.ts';
export { renderPage, renderGrid } from './render.ts';
export { exportMp4, exportGif, drawAt } from './video.ts';
export { setPlatform, platform, hasPlatform, type Platform, type TemplateEntry, type VideoExportOptions } from './platform.ts';
export { engine, withRenderer, type Engine } from './engine.ts';
