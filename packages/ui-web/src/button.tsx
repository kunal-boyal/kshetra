import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` marks the one thing a view exists to do; at most one per view. */
  variant?: 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger';
  /** `sm` for web table rows and toolbars; `lg` forces the comfortable height. */
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Working: the button stays put but can't be pressed again. */
  busy?: boolean;
  icon?: ReactNode;
}

/** A pill-shaped button that scales to 97% when pressed (components/Button). */
export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  busy,
  icon,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn('ks-btn', variant, size !== 'md' && size, block && 'block', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
