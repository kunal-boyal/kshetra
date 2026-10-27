import type { LucideIcon } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { Icon } from './icon';

export interface PickerProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children' | 'aria-label'
> {
  /** What is chosen, for screen readers; the bar shows only the icon and the value. */
  label: string;
  icon: LucideIcon;
  options: readonly { value: string; label: string; lang?: string }[];
}

/**
 * A compact choice in a bar, such as the language or the theme (components/Picker): an icon, the
 * value and a chevron with room around it. A native select underneath, so the keyboard, screen
 * readers and phones work as they do everywhere else.
 */
export function Picker({ label, icon, options, className, ...select }: PickerProps) {
  return (
    <span className={cn('ks-picker', className)}>
      <Icon icon={icon} size="sm" />
      <select className="ks-input" aria-label={label} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
