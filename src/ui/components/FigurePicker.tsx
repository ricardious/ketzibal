import { figureNames, type FigureType } from '../lib/figures';
import { useStore } from '../store';

export function FigurePicker({ action }: { action: 'add' | 'replace' }) {
  const ready = useStore(s => s.status === 'done');
  const label = action === 'add' ? 'Añadir figura' : 'Reemplazar por';
  return (
    <select className="input figure-picker" aria-label={label} value="" disabled={!ready}
      onChange={e => useStore.getState().editFigure(e.target.value as FigureType, action)}>
      <option value="" disabled>{label}…</option>
      {Object.entries(figureNames).map(([type, name]) => <option key={type} value={type}>{name}</option>)}
    </select>
  );
}
