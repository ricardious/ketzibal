import { toSvg } from '../../engine';
import { useStore } from '../store';
import type { SourceImage } from './image';
import { getProject, isRemoved, putProject, requestPersistence, type ProjectSummary, type StoredProject } from './library';

/**
 * Guarda el proyecto abierto en la biblioteca del navegador cada vez que cambia,
 * con una pequeña espera para agrupar ráfagas de ediciones (arrastres, sliders…).
 */
const DELAY = 700;
const THUMB_MAX = 350_000; // más allá, la miniatura usa la imagen original

type State = ReturnType<typeof useStore.getState>;
const images = new WeakMap<SourceImage, Promise<Blob>>();
const created = new Map<string, number>();

// La URL de la imagen se revoca al cambiar de proyecto: se lee en cuanto aparece.
function imageOf(src: SourceImage) {
  let p = images.get(src);
  if (!p) { p = fetch(src.url).then((r) => r.blob()); images.set(src, p); }
  return p;
}

const saveable = (s: State) => !!(s.projectId && !isRemoved(s.projectId) && s.source && s.status === 'done' && s.layers.length);

async function save(s: State) {
  if (!saveable(s)) return;
  const { projectId: id, source: src, layers, params, palette, globalAxis } = s as State & { projectId: string; source: SourceImage };
  const st = useStore.getState();
  if (st.projectId === id) st.set({ saveState: 'saving' });
  try {
    const image = await imageOf(src);
    if (!created.has(id)) created.set(id, (await getProject(id))?.createdAt ?? Date.now());
    const svg = toSvg(src.width, src.height, layers, { ids: false });
    const record: StoredProject = {
      id, name: src.name, createdAt: created.get(id)!, updatedAt: Date.now(),
      width: src.width, height: src.height, image, thumb: svg.length <= THUMB_MAX ? svg : null,
      layers, params, palette, globalAxis,
    };
    if (isRemoved(id)) return;
    await putProject(record);
    requestPersistence();
    const summary: ProjectSummary = {
      id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt,
      width: record.width, height: record.height, image, thumb: record.thumb, layerCount: layers.length,
    };
    const now = useStore.getState();
    now.set({
      projects: [summary, ...now.projects.filter((p) => p.id !== id)],
      ...(now.projectId === id ? { saveState: 'saved' as const } : {}),
    });
  } catch (e) {
    console.error('[ketzibal] No se pudo guardar el proyecto en el navegador:', e);
    const now = useStore.getState();
    if (now.projectId === id) {
      now.set({ saveState: 'error' });
      now.toast('No se pudo guardar en el navegador. Usa «Guardar proyecto» para descargar una copia.');
    }
  }
}

export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: State | null = null;
  const flush = () => { clearTimeout(timer); if (pending) { const s = pending; pending = null; void save(s); } };

  const unsub = useStore.subscribe((s, p) => {
    if (s.source && s.source !== p.source) void imageOf(s.source).catch(() => undefined);
    // Al cambiar de proyecto, lo pendiente del anterior se guarda ya.
    if (s.projectId !== p.projectId) { flush(); return; }
    const changed = s.layers !== p.layers || s.params !== p.params || s.status !== p.status || s.source?.name !== p.source?.name;
    if (!changed || !saveable(s)) return;
    pending = s;
    clearTimeout(timer);
    timer = setTimeout(flush, DELAY);
  });
  const onHide = () => flush();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  void useStore.getState().refreshProjects();
  return () => { unsub(); flush(); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); };
}
