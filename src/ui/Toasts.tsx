import { X } from 'lucide-react';
import { useStore } from './store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const { dismissToast } = useStore.getState();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && (
            <button type="button" className="toast__action" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>
          )}
          <button type="button" className="toast__close" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}><X /></button>
        </div>
      ))}
    </div>
  );
}
