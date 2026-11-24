import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'tonal' | 'outline' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  size?: 'md' | 'sm';
}

/** button-primary / button-with-icon */
export function Button({ variant = 'tonal', icon, size = 'md', className = '', children, ...rest }: ButtonProps) {
  const cls = ['btn', variant !== 'tonal' && `btn--${variant}`, icon && 'btn--with-icon', size === 'sm' && 'btn--sm', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  pressed?: boolean;
  size?: 'md' | 'sm';
}

/** button-icon: siempre con nombre accesible. */
export function IconButton({ label, pressed, size = 'md', className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`btn-icon ${size === 'sm' ? 'btn-icon--sm' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      {children}
    </button>
  );
}
