import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';

/**
 * A button that opens a small panel under it, such as the person's menu behind their avatar
 * (components/MenuButton). A disclosure, not an application menu: the panel holds ordinary links
 * and controls. It closes on Escape, which returns focus to the button, on a click outside, and
 * when something in it calls `close`.
 */
export function MenuButton({
  label,
  trigger,
  children,
  align = 'end',
  className,
}: {
  /** Names the button for screen readers, such as "Your account". */
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn('ks-menu-wrap', className)}>
      <button
        ref={button}
        type="button"
        className="ks-menu-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        {trigger}
      </button>
      <div id={id} className={cn('ks-menu', align)} hidden={!open}>
        {open ? children(() => setOpen(false)) : null}
      </div>
    </div>
  );
}
