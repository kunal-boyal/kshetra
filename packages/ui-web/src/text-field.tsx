import { type InputHTMLAttributes, useId } from 'react';
import { cn } from './cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Says what to enter; replaced by the error while there is one. */
  help?: string;
  /** Says how to fix the value: "Enter the 6-digit code", never "Invalid". */
  error?: string;
  /** Right-aligned tabular figures, for amounts and counts. */
  numeric?: boolean;
  /** Fixed text before the value, such as `+91` or `₹` (the design system's `ks-affix`). */
  prefix?: string;
  /**
   * Keeps a line under the field for its help or error, filled or not, so an error appearing moves
   * nothing after it (`ks-help reserve`), as on sign-in (D104); `2` keeps two, for a long message.
   * Only a field that can show an error needs it.
   */
  reserveNote?: boolean | 2;
}

/** A labelled input with help or an error below it (components/TextField). */
export function TextField({
  label,
  help,
  error,
  numeric,
  prefix,
  required,
  reserveNote = false,
  className,
  ...input
}: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? help;
  const field = (
    <input
      id={id}
      className={cn('ks-input', numeric && 'num', error && 'invalid')}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={note ? noteId : undefined}
      {...input}
    />
  );
  return (
    <div className={cn('ks-field', className)}>
      <label className="ks-label" htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
      {prefix ? (
        <span className={cn('ks-affix', prefix.length > 1 && 'wide')}>
          <span aria-hidden="true">{prefix}</span>
          {field}
        </span>
      ) : (
        field
      )}
      {note || reserveNote ? (
        <p
          id={note ? noteId : undefined}
          className={cn(
            'ks-help',
            error && 'error',
            reserveNote && 'reserve',
            reserveNote === 2 && 'two',
          )}
          role={error ? 'alert' : undefined}
          aria-hidden={note ? undefined : true}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
