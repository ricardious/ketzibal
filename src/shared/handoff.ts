/**
 * Traspaso de una imagen de la página de presentación al editor.
 * Se guarda en IndexedDB del propio navegador y se borra al leerla: nunca sale del equipo.
 */
const DB = 'ketzibal', STORE = 'handoff', KEY = 'pending';

/**
 * Abre una base de datos asegurando que exista `store`. Si la base ya existía sin ese almacén
 * (p. ej. creada por otra versión de la app), la sube de versión para crearlo.
 */
export function openStore(name: string, store: string, options?: IDBObjectStoreParameters,
  setup?: (s: IDBObjectStore) => void, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
    req.onupgradeneeded = () => {
      if (req.result.objectStoreNames.contains(store)) return;
      const s = req.result.createObjectStore(store, options);
      setup?.(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(store)) return resolve(db);
      const next = db.version + 1;
      db.close();
      openStore(name, store, options, setup, next).then(resolve, reject);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Cierra las otras pestañas de Ketzibal e inténtalo de nuevo.'));
  });
}

const open = () => openStore(DB, STORE);

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  }));
}

export async function stashFile(file: File): Promise<boolean> {
  try { await tx('readwrite', (s) => s.put(file, KEY)); return true; } catch { return false; }
}

export async function takeFile(): Promise<File | null> {
  try {
    const f = await tx<File | undefined>('readonly', (s) => s.get(KEY));
    if (f) await tx('readwrite', (s) => s.delete(KEY));
    return f instanceof Blob ? f : null;
  } catch { return null; }
}

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

/** Ruta del editor relativa a la raíz publicada. */
export const APP_URL = `${import.meta.env.BASE_URL}app/`;
export const HOME_URL = import.meta.env.BASE_URL;
