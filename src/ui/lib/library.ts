import type { Layer, SymmetryAxis, VectorizeParams } from '../../engine';
import { openStore } from '../../shared/handoff';

/**
 * Biblioteca de proyectos guardada en el propio navegador (IndexedDB).
 * Nada sale del equipo: cada proyecto guarda la imagen original y el documento editable.
 */
export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  image: Blob;
  /** SVG del resultado para la miniatura; null si es demasiado grande (se usa la imagen). */
  thumb: string | null;
  layers: Layer[];
  params: VectorizeParams;
  palette: string[];
  globalAxis: SymmetryAxis | null;
}

export type ProjectSummary = Omit<StoredProject, 'layers' | 'params' | 'palette' | 'globalAxis'> & { layerCount: number };

// Base propia: la de `ketzibal` la usa el traspaso desde la página de inicio.
const DB = 'ketzibal-library', STORE = 'projects';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = typeof indexedDB === 'undefined'
      ? Promise.reject(new Error('Este navegador no permite guardar proyectos.'))
      : openStore(DB, STORE, { keyPath: 'id' }, (s) => s.createIndex('updatedAt', 'updatedAt'));
    dbPromise.then((db) => {
      // Si el navegador cierra la conexión (otra pestaña sube la versión, se borran datos…), se reabre en el próximo uso.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
    }, () => { dbPromise = null; });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error('Operación cancelada.'));
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  return all
    .map(({ layers, params: _p, palette: _c, globalAxis: _g, ...rest }) => ({ ...rest, layerCount: layers.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getProject = (id: string) => tx<StoredProject | undefined>('readonly', (s) => s.get(id));
export const putProject = (p: StoredProject) => tx('readwrite', (s) => s.put(p));

// Los borrados se recuerdan para que un guardado automático en vuelo no resucite el proyecto.
const removed = new Set<string>();
export const isRemoved = (id: string) => removed.has(id);
export function deleteProject(id: string) {
  removed.add(id);
  return tx('readwrite', (s) => s.delete(id));
}
export function restoreProject(p: StoredProject) {
  removed.delete(p.id);
  return putProject(p);
}

export async function renameProject(id: string, name: string) {
  const p = await getProject(id);
  if (p) await putProject({ ...p, name });
}

/** Pide al navegador que no borre la biblioteca cuando necesite espacio. */
let askedPersist = false;
export function requestPersistence() {
  if (askedPersist) return;
  askedPersist = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

export const newProjectId = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function relativeTime(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 45) return 'hace un momento';
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), 'day');
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
