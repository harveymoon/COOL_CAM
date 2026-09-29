/**
 * The only bridge between the renderer and the Electron main process. Everything else (jobs, tools, fonts) goes over HTTP
 * exactly as in a browser. Here: the native application menu, mirrored from the renderer's menu definitions.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('coolcam', {
  isElectron: true as const,
  platform: process.platform,
  setMenu: (menus: unknown) => ipcRenderer.send('menu:set', menus),
  onMenuClick: (cb: (id: string) => void) => {
    const handler = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('menu:click', handler);
    return () => ipcRenderer.removeListener('menu:click', handler);
  },
});
