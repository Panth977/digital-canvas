/** Node entry: sets the Node platform (import this before using the tools in Node). */
import { hasPlatform, setPlatform } from '../platform.ts';
import { nodePlatform } from './platform.ts';

if (!hasPlatform()) setPlatform(nodePlatform);

export { nodePlatform };
export { FolderWorkspace, NodeFolderStore } from './folder.ts';
export { ffmpeg, runFfmpeg, videoFrame } from './ffmpeg.ts';
export { exportMp4Ffmpeg } from './mp4.ts';
