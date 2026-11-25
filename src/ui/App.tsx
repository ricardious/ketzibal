import { useEffect } from 'react';
import { takeFile } from '../shared/handoff';
import { Canvas } from './Canvas';
import { ContextMenu } from './ContextMenu';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Toasts } from './Toasts';
import { Tooltips } from './components/Tooltip';
import { ProjectsDialog } from './Projects';
import { startAutosave } from './lib/autosave';
import { TopBar } from './TopBar';
import { copySvg, exportFile, saveProject, loadSample, pickFile, VIEW_KEYS, zoomBy } from './lib/actions';
import { ACCEPTED } from './lib/image';
import { useStore } from './store';
import './components/components.css';
import './app.css';

export function App() {
  const theme = useStore((s) => s.theme);
  const panel = useStore((s) => s.panel);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('ketzibal-theme', theme); } catch { /* almacenamiento no disponible */ }
  }, [theme]);

  useEffect(() => startAutosave(), []);

  // Imagen traída desde la página de presentación, o ?ejemplo para cargar la muestra.
  useEffect(() => {
    let live = true;
    void takeFile().then((f) => {
      if (!live) return;
      if (f) void useStore.getState().loadFile(f instanceof File ? f : new File([f], 'imagen.png', { type: (f as Blob).type }));
      else if (new URLSearchParams(location.search).has('ejemplo')) void loadSample();
      if (location.search) history.replaceState(null, '', location.pathname);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!e.repeat) void saveProject(); return; }
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], .mselect__list, .menu')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod && k === 'o') { e.preventDefault(); pickFile(); return; }
      if (mod && k === 'e') { e.preventDefault(); exportFile(); return; }
      if (mod && e.shiftKey && k === 'c') { e.preventDefault(); void copySvg(); return; }
      if (e.key === '?' ) { e.preventDefault(); st.set({ shortcutsOpen: !st.shortcutsOpen }); return; }
      if (e.key === 'Escape') {
        if (st.menu || st.shortcutsOpen || st.projectsOpen) { st.set({ menu: null, shortcutsOpen: false, projectsOpen: false }); return; }
        st.select(null); st.isolate(null); st.set({ panel: null }); return;
      }
      if (st.source && !mod && !e.altKey) {
        if (VIEW_KEYS[e.key] && !st.isolatedId) { st.set({ view: VIEW_KEYS[e.key] }); return; }
        if (k === 'o') { st.set({ showOutlines: !st.showOutlines }); return; }
        if (k === 'e') { st.set({ showAxes: !st.showAxes }); return; }
        if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
        if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.25); return; }
        if (e.key === '0') { st.fit(); return; }
      }
      const sel = st.layers.find((l) => l.id === st.selectedId);
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault();
        if (!st.isolatedId) st.deleteLayer(sel.id);
        return; }
      if (mod && k === 'd') { e.preventDefault(); st.duplicateLayer(sel.id); return; }
      if (!mod && k === 'h') { st.updateLayer(sel.id, { visible: !sel.visible }); return; }
      if (!mod && (e.key === '[' || e.key === ']')) {
        const i = st.layers.indexOf(sel);
        st.moveLayer(sel.id, i + (e.key === ']' ? 1 : -1));
        return;
      }
      if (t.closest('[role="listbox"]')) return; // la lista usa las flechas para navegar
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && sel.kind !== 'background') {
        e.preventDefault();
        // una sola entrada de historial por ráfaga de pulsaciones
        if (!e.repeat) st.beginEdit();
        st.updateLayer(sel.id, { dx: sel.dx + d[0], dy: sel.dy + d[1] }, false);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => ACCEPTED.includes(x.type));
      if (f) { e.preventDefault(); void useStore.getState().loadFile(f); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <LayersPanel />
      <Canvas />
      <Inspector />
      {panel && <div className="scrim" onClick={() => useStore.getState().set({ panel: null })} />}
      <ContextMenu />
      <ShortcutsDialog />
      <ProjectsDialog />
      <Toasts />
      <Tooltips />
    </div>
  );
}
