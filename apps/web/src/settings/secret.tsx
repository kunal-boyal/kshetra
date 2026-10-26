import { Button } from '@thelamp/ui-web';
import { useState } from 'react';
import { useLanguage } from '../i18n';
import { Facts } from '../people/shared';

/** A value someone copies into another system, with a button to copy it. */
export function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <code className="break-all">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('common.copy_named', { name: label })}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

/**
 * A secret shown the one time it exists in the clear (decision D94): the values to copy, a
 * warning that it won't come back, and a way to put it away.
 */
export function SecretPanel({
  title,
  warning,
  values,
  done,
  onDone,
}: {
  title: string;
  warning: string;
  values: readonly [string, string][];
  done: string;
  onDone: () => void;
}) {
  return (
    <section className="ks-card flex flex-col gap-3" aria-label={title}>
      <h2 className="heading-md">{title}</h2>
      <p role="alert">{warning}</p>
      <Facts
        items={values.map(([label, value]) => [
          label,
          <Copyable key={label} label={label} value={value} />,
        ])}
      />
      <Button variant="secondary" className="self-start" onClick={onDone}>
        {done}
      </Button>
    </section>
  );
}
