import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from './cn';

/** The note under a field: its help, or the error that replaces it. */
function Note({ id, help, error }: { id: string; help?: string; error?: string }) {
  const note = error ?? help;
  if (!note) return null;
  return (
    <p id={id} className={cn('ks-help', error && 'error')} role={error ? 'alert' : undefined}>
      {note}
    </p>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: readonly { value: string; label: string }[];
  /** A first choice that means none, such as "No manager"; its value is the empty string. */
  none?: string;
  help?: string;
  error?: string;
}

/** A labelled choice from a list, styled as the inputs are (components/TextField). */
export function SelectField({
  label,
  options,
  none,
  help,
  error,
  required,
  className,
  ...select
}: SelectFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={cn('ks-field', className)}>
      <label className="ks-label" htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      <select
        id={id}
        className={cn('ks-input', error && 'invalid')}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || help ? noteId : undefined}
        {...select}
      >
        {none !== undefined ? <option value="">{none}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Note id={noteId} {...(help ? { help } : {})} {...(error ? { error } : {})} />
    </div>
  );
}

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  help?: string;
  error?: string;
}

/** A labelled box for longer text, styled as the inputs are. */
export function TextAreaField({
  label,
  help,
  error,
  required,
  className,
  rows = 4,
  ...area
}: TextAreaFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={cn('ks-field', className)}>
      <label className="ks-label" htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      <textarea
        id={id}
        rows={rows}
        className={cn('ks-input h-auto py-2', error && 'invalid')}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || help ? noteId : undefined}
        {...area}
      />
      <Note id={noteId} {...(help ? { help } : {})} {...(error ? { error } : {})} />
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** A line under the label. */
  detail?: string;
}

/** A checkbox with its label beside it; the whole row toggles it. */
export function Checkbox({ label, detail, className, ...input }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 py-1', className)}>
      <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" {...input} />
      <span className="flex flex-col">
        <span>{label}</span>
        {detail ? <span className="ks-help">{detail}</span> : null}
      </span>
    </label>
  );
}

/** A titled group of checkboxes or other choices, with an error for the group. */
export function ChoiceGroup({
  legend,
  error,
  children,
  className,
}: {
  legend: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('ks-field', className)}>
      <legend className="ks-label">{legend}</legend>
      {children}
      {error ? (
        <p className="ks-help error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
