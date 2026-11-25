import { useStore, type ViewMode } from '../store';
import { download, sampleFile } from './sample';

import { projectExtension, serializeProject } from './project';

export async function saveProject() {
  const { source, status, layers, palette, params, globalAxis, toast } = st();
  if (!source || status !== 'done') return;
  try {
    const text = await serializeProject(source, { layers, palette, params, globalAxis });
    const name = (source.name.replace(/\.[^.]+$/, '') || 'proyecto') + projectExtension;
    download(text, name, 'application/json');
    toast(`Proyecto descargado: ${name}`);
  } catch {
    toast('No se pudo guardar el proyecto.');
  }
}

const st = () => useStore.getState();

export function exportFile() {
  const { source, layers, status, exportSvg, toast } = st();
  if (!source || !layers.length || status === 'processing') return;
  const name = `${source.name.replace(/\.[^.]+$/, '') || 'vectorizado'}.svg`;
  download(exportSvg(), name);
  toast(`${name} exportado`);
}

export async function copySvg() {
  const { layers, status, exportSvg, toast } = st();
  if (!layers.length || status === 'processing') return;
  try {
    await navigator.clipboard.writeText(exportSvg());
    toast('SVG copiado al portapapeles');
  } catch {
    toast('El navegador no permitió copiar. Usa Exportar SVG.');
  }
}

export async function copyColor(hex: string) {
  try { await navigator.clipboard.writeText(hex); st().toast(`${hex} copiado`); } catch { /* sin portapapeles */ }
}

export async function loadSample() {
  const f = await sampleFile();
  await st().loadFile(f);
}

/** Abre el selector de archivos del sistema. */
export function pickFile() {
  document.getElementById('file-import')?.click();
}

export const VIEW_KEYS: Record<string, ViewMode> = { '1': 'original', '2': 'vector', '3': 'split', '4': 'overlay' };

export function zoomBy(k: number) {
  const { zoom, set } = st();
  set({ zoom: Math.max(0.1, Math.min(40, zoom * k)) });
}
