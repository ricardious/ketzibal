import { Download, ImageUp, Layers, Moon, Redo2, SlidersHorizontal, Sun, SunMoon, Undo2 } from 'lucide-react';
import { useRef } from 'react';
import { Button, IconButton } from './components/Button';
import { ACCEPTED } from './lib/image';
import { download } from './lib/sample';
import { useStore, type Theme } from './store';

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Tema: sistema', light: 'Tema: claro', dark: 'Tema: oscuro' };

export function TopBar() {
  const input = useRef<HTMLInputElement>(null);
  const source = useStore((s) => s.source);
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasLayers = useStore((s) => s.layers.length > 0);
  const theme = useStore((s) => s.theme);
  const panel = useStore((s) => s.panel);
  const { loadFile, undo, redo, exportSvg, set } = useStore.getState();

  const onExport = () => {
    const svg = exportSvg();
    const base = source?.name.replace(/\.[^.]+$/, '') || 'vectorizado';
    download(svg, `${base}.svg`);
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon;

  return (
    <header className="topbar">
      <IconButton className="only-compact" label="Capas" pressed={panel === 'layers'} onClick={() => set({ panel: panel === 'layers' ? null : 'layers' })}>
        <Layers />
      </IconButton>
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}ketzvia-simbolo.svg`} alt="" />
        <span>Ketzibal</span>
      </div>
      {source && (
        <div className="topbar__file">
          <b title={source.name}>{source.name}</b>
          <span className="t-mono-sm">{source.width}×{source.height}</span>
        </div>
      )}
      <div className="topbar__spacer" />
      <div className="topbar__group">
        <IconButton label="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 /></IconButton>
        <IconButton label="Rehacer (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Redo2 /></IconButton>
        <IconButton label={THEME_LABEL[theme]} onClick={() => set({ theme: NEXT_THEME[theme] })}><ThemeIcon /></IconButton>
      </div>
      <span className="topbar__divider hide-compact" />
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = '';
        }}
      />
      <Button className="collapse-label" icon={<ImageUp />} onClick={() => input.current?.click()} aria-label="Importar imagen">
        <span className="label">Importar imagen</span>
      </Button>
      <Button className="collapse-label" variant="primary" icon={<Download />} disabled={!hasLayers || status === 'processing'} onClick={onExport} aria-label="Exportar SVG">
        <span className="label">Exportar SVG</span>
      </Button>
      <IconButton className="only-compact" label="Inspector" pressed={panel === 'inspector'} onClick={() => set({ panel: panel === 'inspector' ? null : 'inspector' })}>
        <SlidersHorizontal />
      </IconButton>
      {status === 'processing' && progress && (
        <div className="topbar__progress" role="progressbar" aria-label={progress.stage} aria-valuenow={Math.round(progress.value * 100)}>
          <i style={{ transform: `scaleX(${progress.value})` }} />
        </div>
      )}
    </header>
  );
}
