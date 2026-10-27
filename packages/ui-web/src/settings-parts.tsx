import { X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cn } from './cn';
import { Icon } from './icon';
import type { Hue } from './surfaces';

/**
 * A setting that is on or off, as a row with what it does (components/SettingsParts). A native
 * checkbox drawn as a switch, so the keyboard and screen readers treat it as one.
 */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="ks-switch-row">
      <label htmlFor={id} className="ks-switch-text">
        <span className="ks-title">{label}</span>
        {description ? <span className="ks-meta">{description}</span> : null}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="ks-switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

/**
 * One of a few options shown as cards, such as a template to start from (components/SettingsParts):
 * the chosen one carries the accent ring.
 */
export function ChoiceCard({
  title,
  description,
  icon,
  hue,
  pressed,
  onClick,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  hue?: Hue;
  pressed: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn('ks-card ks-choice', hue && `tint hue-${hue}`)}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
      <span className="ks-title">{title}</span>
      {description ? <span className="ks-meta">{description}</span> : null}
      {children}
    </button>
  );
}

/** Short tags, such as a webhook's events or a field's choices, with a way to remove each. */
export function ChipList({
  label,
  items,
  onRemove,
  removeLabel,
  add,
}: {
  label: string;
  items: readonly string[];
  onRemove?: (item: string) => void;
  removeLabel?: (item: string) => string;
  add?: ReactNode;
}) {
  return (
    <ul className="ks-chiplist" aria-label={label}>
      {items.map((item) => (
        <li key={item} className="ks-badge neutral">
          {item}
          {onRemove ? (
            <button
              type="button"
              aria-label={removeLabel ? removeLabel(item) : item}
              onClick={() => onRemove(item)}
            >
              <Icon icon={X} size="sm" />
            </button>
          ) : null}
        </li>
      ))}
      {add ? <li>{add}</li> : null}
    </ul>
  );
}
