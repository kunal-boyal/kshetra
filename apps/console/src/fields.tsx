import { emailMessage, mobileMessage } from '@thelamp/i18n';
import { mobileDigitsFrom } from '@thelamp/shared';
import { TextField, type TextFieldProps } from '@thelamp/ui-web';
import { useState } from 'react';
import { useLanguage } from './i18n';

type FieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'prefix' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  /** Shows the check's message now, as after a submit; it shows anyway once the field is left. */
  checked?: boolean;
};

/**
 * A 10-digit Indian mobile number (decision D102): `+91` shown before it, digits only, a pasted
 * +91 or 0 dropped. `landline` takes any 10-digit number, for a business's contact.
 */
export function MobileField({
  value,
  onChange,
  checked,
  error,
  required,
  landline,
  onBlur,
  ...field
}: FieldProps & { landline?: boolean }) {
  const { t } = useLanguage();
  const [left, setLeft] = useState(false);
  const message = mobileMessage(value, Boolean(required), landline);
  return (
    <TextField
      help={t('common.mobile_help')}
      {...field}
      required={required}
      prefix="+91"
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      value={value}
      error={error ?? ((left || checked) && message ? t(message) : undefined)}
      onChange={(event) => onChange(mobileDigitsFrom(event.target.value))}
      onBlur={(event) => {
        setLeft(true);
        onBlur?.(event);
      }}
    />
  );
}

/** An email address, checked by the rule the API applies (decision D102). */
export function EmailField({
  value,
  onChange,
  checked,
  error,
  required,
  onBlur,
  ...field
}: FieldProps) {
  const { t } = useLanguage();
  const [left, setLeft] = useState(false);
  const message = emailMessage(value, Boolean(required));
  return (
    <TextField
      {...field}
      required={required}
      type="email"
      inputMode="email"
      autoComplete="email"
      value={value}
      error={error ?? ((left || checked) && message ? t(message) : undefined)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        setLeft(true);
        onBlur?.(event);
      }}
    />
  );
}
