import { emailMessage, mobileMessage } from '@thelamp/i18n';
import { mobileDigitsFrom } from '@thelamp/shared';
import { TextField, type TextFieldProps } from '@thelamp/ui-web';
import { useLanguage } from './i18n';

type FieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'prefix' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  /**
   * Shows the check's message, once the form was sent (its button or Enter): never on leaving the
   * field, so clicking elsewhere says nothing (D104).
   */
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
  ...field
}: FieldProps & { landline?: boolean }) {
  const { t } = useLanguage();
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
      error={error ?? (checked && message ? t(message) : undefined)}
      onChange={(event) => onChange(mobileDigitsFrom(event.target.value))}
    />
  );
}

/** An email address, checked by the rule the API applies (decision D102). */
export function EmailField({ value, onChange, checked, error, required, ...field }: FieldProps) {
  const { t } = useLanguage();
  const message = emailMessage(value, Boolean(required));
  return (
    <TextField
      {...field}
      required={required}
      type="email"
      inputMode="email"
      autoComplete="email"
      value={value}
      error={error ?? (checked && message ? t(message) : undefined)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
