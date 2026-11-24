/// <reference lib="webworker" />
import { vectorize } from './pipeline';
import type { Progress, VectorizeParams, VectorizeResult } from './types';

export type WorkerRequest = {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  params: VectorizeParams;
};

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: Progress }
  | { id: number; type: 'done'; result: VectorizeResult }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, width, height, buffer, params } = e.data;
  const post = (m: WorkerResponse) => ctx.postMessage(m);
  try {
    const result = vectorize({ width, height, data: new Uint8ClampedArray(buffer) }, params, (progress) =>
      post({ id, type: 'progress', progress }),
    );
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
