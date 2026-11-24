import type { WorkerRequest, WorkerResponse } from './worker';
import type { Progress, RasterImage, VectorizeParams, VectorizeResult } from './types';

/**
 * Ejecuta el motor en un Web Worker. Una petición nueva cancela la anterior
 * (se termina el worker) para que la interfaz responda al instante.
 */
export class Vectorizer {
  private worker: Worker | null = null;
  private seq = 0;
  private reject: ((e: Error) => void) | null = null;

  run(img: RasterImage, params: VectorizeParams, onProgress: (p: Progress) => void): Promise<VectorizeResult> {
    this.cancel();
    const worker = (this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.id !== this.seq) return;
        if (m.type === 'progress') onProgress(m.progress);
        else if (m.type === 'done') { this.reject = null; resolve(m.result); }
        else { this.reject = null; reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { this.reject = null; reject(new Error(e.message || 'Error en el motor de vectorización')); };
      // se copia el búfer: la imagen original sigue disponible para comparar
      const buffer = img.data.slice().buffer;
      const req: WorkerRequest = { id, width: img.width, height: img.height, buffer, params };
      worker.postMessage(req, [buffer]);
    });
  }

  cancel() {
    this.worker?.terminate();
    this.worker = null;
    if (this.reject) { this.reject(new CancelledError()); this.reject = null; }
  }
}

export class CancelledError extends Error {
  constructor() { super('cancelado'); }
}
