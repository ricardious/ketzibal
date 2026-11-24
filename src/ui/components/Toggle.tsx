import { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

/** toggle-standard / toggle-label / toggle-description */
export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label ? undefined : 'Alternar'}
      aria-describedby={description ? `${id}-d` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
  if (!label) return sw;
  return (
    <div className={`toggle ${disabled ? 'toggle--disabled' : ''}`} onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.toggle__text')) !disabled && onChange(!checked); }}>
      <div className="toggle__text">
        <label className="toggle__label" htmlFor={id} onClick={(e) => e.preventDefault()}>{label}</label>
        {description && <span className="toggle__desc" id={`${id}-d`}>{description}</span>}
      </div>
      {sw}
    </div>
  );
}
