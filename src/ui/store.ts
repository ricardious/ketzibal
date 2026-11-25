import { isProject, readProject } from './lib/project';
import { makeFigure, replaceFigure, type FigureType } from './lib/figures';
import { joinStrokes } from '../engine/join';
import { create } from 'zustand';
import { CancelledError, DEFAULT_PARAMS, toSvg, Vectorizer, type Layer, type Progress, type SymmetryAxis, type VectorizeParams } from '../engine';
import { loadImageFile, type SourceImage } from './lib/image';
import { measureAccuracy } from './lib/accuracy';
import { deleteProject, getProject, listProjects, newProjectId, renameProject, restoreProject, type ProjectSummary } from './lib/library';

export type ViewMode = 'split' | 'original' | 'vector' | 'overlay';
export type Theme = 'system' | 'light' | 'dark';
export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
let toastSeq = 0;

interface State {
  source: SourceImage | null;
  params: VectorizeParams;
  status: 'idle' | 'loading' | 'processing' | 'done' | 'error';
  progress: Progress | null;
  contours: string;
  error: string | null;

  layers: Layer[];
  palette: string[];
  globalAxis: SymmetryAxis | null;
  stats: { regions: number; ms: number } | null;
  accuracy: number | null;

  selectedId: string | null;
  additionalIds: string[];
  isolatedId: string | null;
  past: Layer[][];
  future: Layer[][];

  view: ViewMode;
  split: number;
  overlayOpacity: number;
  showOutlines: boolean;
  showAxes: boolean;
  zoom: number;
  pan: [number, number];
  theme: Theme;
  panel: 'layers' | 'inspector' | null;
  hoverId: string | null;
  toasts: Toast[];
  shortcutsOpen: boolean;
  menu: { x: number; y: number; id: string } | null;

  /** Proyecto de la biblioteca del navegador que está abierto. */
  projectId: string | null;
  projects: ProjectSummary[];
  projectsOpen: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';

  loadFile: (f: File) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  newProject: () => void;
  refreshProjects: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  setParam: <K extends keyof VectorizeParams>(k: K, v: VectorizeParams[K]) => void;
  resetParams: () => void;
  run: () => Promise<void>;

  select: (id: string | null, additive?: boolean) => void;
  joinSelected: () => void;
  applyDrawing: (pieces: Layer[], original?: Layer) => void;
  editFigure: (type: FigureType, action: 'add' | 'replace') => void;
  isolate: (id: string | null) => void;
  updateLayer: (id: string, patch: Partial<Layer>, record?: boolean) => void;
  beginEdit: () => void;
  moveLayer: (id: string, toIndex: number) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  toast: (text: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  fit: () => void;
  undo: () => void;
  redo: () => void;

  set: (p: Partial<State>) => void;
  exportSvg: () => string;
}

const vectorizer = new Vectorizer();
let loadSequence = 0;
let paramTimer: ReturnType<typeof setTimeout> | undefined;
let accTimer: ReturnType<typeof setTimeout> | undefined;

const readTheme = (): Theme => {
  try { return (localStorage.getItem('ketzibal-theme') as Theme) || 'system'; } catch { return 'system'; }
};

export const useStore = create<State>((set, get) => {
  const scheduleAccuracy = () => {
    clearTimeout(accTimer);
    accTimer = setTimeout(async () => {
      const { source, layers } = get();
      if (!source || layers.length === 0) return;
      try {
        const acc = await measureAccuracy(toSvg(source.width, source.height, layers, { ids: false }), source.raster);
        if (get().layers === layers) set({ accuracy: acc });
      } catch {
        set({ accuracy: null });
      }
    }, 250);
  };

  const commit = (layers: Layer[], record = true) => {
    const { layers: prev, past } = get();
    set({ layers, ...(record ? { past: [...past.slice(-99), prev], future: [] } : {}) });
    scheduleAccuracy();
  };

  return {
    source: null,
    params: { ...DEFAULT_PARAMS },
    status: 'idle',
    contours: '',
    progress: null,
    error: null,
    layers: [],
    palette: [],
    globalAxis: null,
    stats: null,
    accuracy: null,
    selectedId: null, additionalIds: [],
    isolatedId: null,
    past: [],
    future: [],
    view: 'split',
    split: 0.5,
    overlayOpacity: 0.5,
    showOutlines: false,
    showAxes: true,
    zoom: 1,
    pan: [0, 0],
    theme: readTheme(),
    panel: null,
    hoverId: null,
    toasts: [],
    shortcutsOpen: false,
    menu: null,
    projectId: null,
    projects: [],
    projectsOpen: false,
    saveState: 'idle',

    async loadFile(file) {
      const sequence = ++loadSequence;
      clearTimeout(paramTimer);
      vectorizer.cancel();
      set({ status: 'loading', error: null });
      try {
        const project = isProject(file) ? await readProject(file) : null;
        const src = project?.source ?? await loadImageFile(file);
        if (sequence !== loadSequence) { URL.revokeObjectURL(src.url); return; }
        const old = get().source;
        if (old) URL.revokeObjectURL(old.url);
        set({ source: src, projectId: newProjectId(), saveState: 'idle', layers: [], past: [], future: [], selectedId: null, additionalIds: [], isolatedId: null, accuracy: null, zoom: 1, pan: [0, 0] });
        if (project) {
          set({ ...project, status: 'done', progress: null, stats: null, contours: '', view: 'vector', hoverId: null, menu: null });
          scheduleAccuracy();
        } else await get().run();
      } catch (e) {
        if (sequence !== loadSequence) return;
        const error = e instanceof Error ? e.message : String(e);
        if (get().source) { set({ status: 'done' }); get().toast(error); }
        else { set({ status: 'error', error }); get().toast(error); }
      }
    },

    async openProject(id) {
      if (id === get().projectId) { set({ projectsOpen: false }); return; }
      const sequence = ++loadSequence;
      clearTimeout(paramTimer);
      vectorizer.cancel();
      set({ status: 'loading', error: null, projectsOpen: false });
      try {
        const p = await getProject(id);
        if (!p) throw new Error('Ese proyecto ya no está en este navegador.');
        const src = await loadImageFile(new File([p.image], p.name, { type: p.image.type }));
        src.name = p.name;
        if (sequence !== loadSequence) { URL.revokeObjectURL(src.url); return; }
        const old = get().source;
        if (old) URL.revokeObjectURL(old.url);
        set({
          source: src, projectId: id, saveState: 'saved',
          layers: p.layers, params: { ...DEFAULT_PARAMS, ...p.params }, palette: p.palette, globalAxis: p.globalAxis,
          past: [], future: [], selectedId: null, additionalIds: [], isolatedId: null, accuracy: null, zoom: 1, pan: [0, 0],
          status: 'done', progress: null, stats: null, contours: '', view: 'vector', hoverId: null, menu: null,
        });
        scheduleAccuracy();
      } catch (e) {
        if (sequence !== loadSequence) return;
        set({ status: get().source ? 'done' : 'idle' });
        get().toast(e instanceof Error ? e.message : String(e));
        void get().refreshProjects();
      }
    },

    newProject() {
      ++loadSequence;
      clearTimeout(paramTimer);
      vectorizer.cancel();
      const old = get().source;
      if (old) URL.revokeObjectURL(old.url);
      set({
        source: null, projectId: null, saveState: 'idle', status: 'idle', error: null, progress: null, contours: '',
        layers: [], palette: [], globalAxis: null, stats: null, accuracy: null, params: { ...DEFAULT_PARAMS },
        past: [], future: [], selectedId: null, additionalIds: [], isolatedId: null, hoverId: null, menu: null,
        zoom: 1, pan: [0, 0], projectsOpen: false,
      });
      void get().refreshProjects();
    },

    async refreshProjects() {
      try { set({ projects: await listProjects() }); } catch { /* sin almacenamiento: la lista queda vacía */ }
    },

    async renameProject(id, name) {
      name = name.trim();
      if (!name) return;
      set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
      const src = get().source;
      if (id === get().projectId && src) set({ source: { ...src, name } });
      try { await renameProject(id, name); } catch { get().toast('No se pudo cambiar el nombre.'); }
    },

    async removeProject(id) {
      const record = await getProject(id).catch(() => undefined);
      try { await deleteProject(id); } catch { get().toast('No se pudo eliminar el proyecto.'); return; }
      if (id === get().projectId) get().newProject();
      set({ projects: get().projects.filter((p) => p.id !== id) });
      if (record) get().toast(`«${record.name}» eliminado`, {
        label: 'Deshacer',
        run: () => void restoreProject(record).then(() => get().refreshProjects()),
      });
    },

    setParam(k, v) {
      set({ params: { ...get().params, [k]: v } });
      clearTimeout(paramTimer);
      paramTimer = setTimeout(() => void get().run(), 220);
    },

    resetParams() {
      set({ params: { ...DEFAULT_PARAMS } });
      void get().run();
    },

    async run() {
      const { source, params } = get();
      if (!source) return;
      set({ status: 'processing', contours: '', progress: { stage: 'Preparando imagen', value: 0 }, error: null });
      try {
        const r = await vectorizer.run(source.raster, params, (progress) => set(state => ({ progress, contours: state.contours + (progress.contours ?? '') })));
        const sel = get().selectedId;
        set({
          status: 'done',
          contours: '',
          progress: null,
          layers: r.layers,
          palette: r.palette,
          globalAxis: r.globalAxis,
          stats: { regions: r.stats.regions, ms: r.stats.ms },
          past: [],
          future: [],
          selectedId: r.layers.some((l) => l.id === sel) ? sel : null,
          additionalIds: [], isolatedId: null,
          accuracy: null,
        });
        scheduleAccuracy();
      } catch (e) {
        if (e instanceof CancelledError) return;
        set({ status: 'error', progress: null, error: e instanceof Error ? e.message : String(e) });
      }
    },

    select(id, additive) {
      const { selectedId, additionalIds, isolatedId } = get();
      if (isolatedId && !id) return;
      if (!additive || !id || !selectedId || isolatedId) {
        set({ selectedId: id, additionalIds: [], isolatedId: isolatedId ? id : null });
        return;
      }
      if (selectedId === id) set({ selectedId: additionalIds[0] ?? null, additionalIds: additionalIds.slice(1) });
      else set({ additionalIds: additionalIds.includes(id) ? additionalIds.filter(i => i !== id) : [...additionalIds, id] });
    },
    isolate: (id) => set({ isolatedId: id, additionalIds: [], ...(id ? { selectedId: id } : {}) }),
    editFigure(type, action) {
      const { source, layers, selectedId, status, additionalIds } = get();
      if (!source || status !== 'done') return;
      const current = layers.find(l => l.id === selectedId);
      const size = Math.min(source.width, source.height) / 5;
      let figure: Layer;
      if (action === 'replace') {
        if (!current || current.kind === 'background' || additionalIds.length) return;
        figure = replaceFigure(current, type);
        commit(layers.map(l => l === current ? figure : l));
      } else {
        figure = makeFigure(type, [source.width / 2, source.height / 2], size, type === 'ellipse' || type === 'rect' ? size * 0.7 : size);
        commit([...layers, figure]);
      }
      set({ selectedId: figure.id, isolatedId: figure.id, additionalIds: [], panel: null });
    },
    applyDrawing(pieces, original) {
      const { layers, status, isolatedId } = get();
      if (status !== 'done' || !pieces.length || (original && !layers.includes(original))) return;
      commit(original ? layers.flatMap(l => l === original ? pieces : [l]) : [...layers, ...pieces]);
      set({ selectedId: pieces[0].id, additionalIds: [], isolatedId: !original && isolatedId ? pieces[0].id : null, view: 'vector' });
    },
    joinSelected() {
      const { layers, selectedId, additionalIds, source } = get();
      const ids = new Set([selectedId, ...additionalIds]);
      const members = layers.filter(l => ids.has(l.id));
      const primary = members.find(l => l.id === selectedId);
      if (!source || !primary || members.length < 2 || members.some(l => l.shape.type !== 'strokes' || !l.stroke)) return;
      const { layer: joined, connections } = joinStrokes(primary, members, source.raster);
      commit(layers.filter(l => !ids.has(l.id) || l.id === primary.id).map(l => l.id === primary.id ? joined : l));
      set({ additionalIds: [] });
      get().toast(connections ? `Conexiones realizadas: ${connections}` : 'Trazos agrupados. La imagen no muestra una conexión clara.');
    },

    beginEdit() {
      const { layers, past } = get();
      set({ past: [...past.slice(-99), layers], future: [] });
    },

    updateLayer(id, patch, record = true) {
      commit(get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), record);
    },

    moveLayer(id, toIndex) {
      const layers = [...get().layers];
      const from = layers.findIndex((l) => l.id === id);
      if (from < 0) return;
      const [l] = layers.splice(from, 1);
      layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
      commit(layers);
    },

    deleteLayer(id) {
      const { selectedId, isolatedId } = get();
      const gone = get().layers.find((l) => l.id === id);
      if (!gone) return;
      commit(get().layers.filter((l) => l.id !== id));
      set({ additionalIds: [], hoverId: null, selectedId: selectedId === id ? null : selectedId, isolatedId: isolatedId === id ? null : isolatedId });
      get().toast(`«${gone.name}» eliminada`, { label: 'Deshacer', run: () => { get().undo(); if (get().layers.some((l) => l.id === id)) set({ selectedId: id }); } });
    },

    duplicateLayer(id) {
      const { layers, status } = get();
      const i = layers.findIndex((l) => l.id === id);
      if (i < 0 || status !== 'done' || layers[i].kind === 'background') return;
      const src = layers[i];
      const copy: Layer = { ...src, id: crypto.randomUUID(), name: `${src.name} (copia)`, dx: src.dx + 8, dy: src.dy + 8 };
      commit([...layers.slice(0, i + 1), copy, ...layers.slice(i + 1)]);
      set({ selectedId: copy.id, additionalIds: [], isolatedId: get().isolatedId ? copy.id : null });
    },

    toast(text, action) {
      const t: Toast = { id: ++toastSeq, text, action };
      set({ toasts: [...get().toasts.slice(-2), t] });
      setTimeout(() => get().dismissToast(t.id), action ? 6000 : 2800);
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    fit: () => set({ zoom: 1, pan: [0, 0] }),

    undo() {
      const { past, layers, future } = get();
      if (!past.length) return;
      const previous = past[past.length - 1];
      const sel = previous.some(l => l.id === get().selectedId) ? get().selectedId : null;
      set({ additionalIds: [], isolatedId: get().isolatedId === sel ? sel : null, selectedId: sel, layers: previous, past: past.slice(0, -1), future: [layers, ...future] });
      scheduleAccuracy();
    },

    redo() {
      const { past, layers, future } = get();
      if (!future.length) return;
      set({ additionalIds: [], isolatedId: null, selectedId: future[0].some(l => l.id === get().selectedId) ? get().selectedId : null, layers: future[0], future: future.slice(1), past: [...past, layers] });
      scheduleAccuracy();
    },

    set: (p) => set(p),

    exportSvg() {
      const { source, layers } = get();
      if (!source) return '';
      return toSvg(source.width, source.height, layers);
    },
  };
});
