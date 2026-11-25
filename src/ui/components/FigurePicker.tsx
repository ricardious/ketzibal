import { Plus, Replace } from 'lucide-react';
import { FIGURE_ICONS } from '../lib/figure-icons';
import { figureNames, type FigureType } from '../lib/figures';
import { useStore } from '../store';
import { MenuSelect } from './MenuSelect';

const OPTIONS = (Object.entries(figureNames) as [FigureType, string][]).map(([value, label]) => ({ value, label, icon: FIGURE_ICONS[value] }));

export function FigurePicker({ action }: { action: 'add' | 'replace' }) {
  const ready = useStore(s => s.status === 'done');
  return (
    <MenuSelect
      className="figure-picker"
      label={action === 'add' ? 'Añadir figura' : 'Reemplazar por…'}
      icon={action === 'add' ? <Plus /> : <Replace />}
      options={OPTIONS}
      disabled={!ready}
      onSelect={(type) => useStore.getState().editFigure(type, action)}
    />
  );
}
