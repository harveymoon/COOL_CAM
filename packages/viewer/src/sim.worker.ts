/// <reference lib="webworker" />
import { StockSim } from '@cool-cam/sim';
import type { Job, Toolpath } from '@cool-cam/core';

let sim: StockSim | null = null;

export type SimRequest =
  | { type: 'init'; job: Job; toolpaths: Toolpath[]; resolution?: number }
  | { type: 'seek'; index: number };
export type SimResponse =
  | { type: 'ready'; w: number; h: number; res: number; x0: number; y0: number; top: number; bottom: number; summary: ReturnType<StockSim['summary']>; timeline: Float64Array; heights: Float32Array }
  | { type: 'heights'; index: number; heights: Float32Array; removed: number }
  | { type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      sim = new StockSim(msg.job, msg.toolpaths, { resolution: msg.resolution, keyframeEvery: 200 });
      const summary = sim.runAll();
      const heights = sim.heights.slice();
      const timeline = sim.timeline();
      const out: SimResponse = { type: 'ready', w: sim.w, h: sim.h, res: sim.res, x0: sim.x0, y0: sim.y0, top: sim.top, bottom: sim.bottom, summary, timeline, heights };
      (self as unknown as Worker).postMessage(out, [heights.buffer, timeline.buffer]);
    } else if (msg.type === 'seek' && sim) {
      sim.seek(msg.index);
      const heights = sim.heights.slice();
      const out: SimResponse = { type: 'heights', index: msg.index, heights, removed: sim.removedVolume };
      (self as unknown as Worker).postMessage(out, [heights.buffer]);
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (e as Error).message } satisfies SimResponse);
  }
};
