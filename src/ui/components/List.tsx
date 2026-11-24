import type { HTMLAttributes, ReactNode } from 'react';

interface ListItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'children'> {
  primary: ReactNode;
  secondary?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  interactive?: boolean;
  selected?: boolean;
}

/** list-single / list-two-line / list-leading-icon / list-trailing-action / list-interactive */
export function ListItem({ primary, secondary, leading, trailing, interactive, selected, className = '', ...rest }: ListItemProps) {
  const cls = ['list-item', secondary && 'list-item--two-line', interactive && 'list-item--interactive', className].filter(Boolean).join(' ');
  return (
    <li className={cls} aria-selected={interactive ? !!selected : undefined} {...rest}>
      {leading && <span className="list-item__leading">{leading}</span>}
      <span className="list-item__text">
        <span className="list-item__primary">{primary}</span>
        {secondary && <span className="list-item__secondary">{secondary}</span>}
      </span>
      {trailing && <span className="list-item__trailing" onClick={(e) => e.stopPropagation()}>{trailing}</span>}
    </li>
  );
}

export function List({ children, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className="list" {...rest}>{children}</ul>;
}
