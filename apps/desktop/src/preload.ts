/**
 * The one door between the page and the app. The page is the same web build
 * as the hosted site; finding `window.dcDesktop` is how it knows where it runs.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dcDesktop', {
  initial: ipcRenderer.sendSync('dc:state'),
  call: (op: string, args?: unknown) => ipcRenderer.invoke('dc', op, args),
  on(event: 'state' | 'changed' | 'request', cb: (data: unknown) => void) {
    const listener = (_: unknown, data: unknown) => cb(data);
    ipcRenderer.on(`dc:${event}`, listener);
    return () => ipcRenderer.off(`dc:${event}`, listener);
  },
});
