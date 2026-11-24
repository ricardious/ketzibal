import { makeFigure, replaceFigure, type FigureType } from './lib/figures';
import { joinStrokes } from '../engine/join';
import { create } from 'zustand';
import { CancelledError, DEFAULT_PARAMS, toSvg, Vectorizer, type Layer, type Progress, type SymmetryAxis, type VectorizeParams } from '../engine';
import { loadImageFile, type SourceImage } from './lib/image';
import { measureAccuracy } from './lib/accuracy';

export type ViewMode = 'split' | 'original' | 'vector' | 'overlay';
export type Theme = 'system' | 'light' | 'dark';

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

  loadFile: (f: File) => Promise<void>;
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
  undo: () => void;
  redo: () => void;

  set: (p: Partial<State>) => void;
  exportSvg: () => string;
}

const vectorizer = new Vectorizer();
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

    async loadFile(file) {
      set({ status: 'loading', error: null });
      try {
        const src = await loadImageFile(file);
        const old = get().source;
        if (old) URL.revokeObjectURL(old.url);
        set({ source: src, layers: [], past: [], future: [], selectedId: null, additionalIds: [], isolatedId: null, accuracy: null, zoom: 1, pan: [0, 0] });
        await get().run();
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
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
      const { layers, selectedId, additionalIds } = get();
      const ids = new Set([selectedId, ...additionalIds]);
      const members = layers.filter(l => ids.has(l.id));
      const primary = members.find(l => l.id === selectedId);
      if (!primary || members.length < 2 || members.some(l => l.shape.type !== 'strokes' || !l.stroke)) return;
      const joined = joinStrokes(primary, members);
      commit(layers.filter(l => !ids.has(l.id) || l.id === primary.id).map(l => l.id === primary.id ? joined : l));
      set({ additionalIds: [] });
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
      commit(get().layers.filter((l) => l.id !== id));
      set({ additionalIds: [], selectedId: selectedId === id ? null : selectedId, isolatedId: isolatedId === id ? null : isolatedId });
    },

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
