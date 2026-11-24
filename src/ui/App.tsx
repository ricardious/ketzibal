import { useEffect } from 'react';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { TopBar } from './TopBar';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      const sel = st.layers.find((l) => l.id === st.selectedId);
      if (e.key === 'Escape') { st.select(null); st.isolate(null); st.set({ panel: null }); return; }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.deleteLayer(sel.id); return; }
      if (t.closest('[role="listbox"]')) return; // la lista usa las flechas para navegar
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && sel.kind !== 'background') { e.preventDefault(); st.updateLayer(sel.id, { dx: sel.dx + d[0], dy: sel.dy + d[1] }); }
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
    </div>
  );
}
