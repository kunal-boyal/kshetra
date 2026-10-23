import { UserListResult } from '@thelamp/shared';
import { Button, TextField } from '@thelamp/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useApp } from '../context';
import { useLanguage } from '../i18n';
import { read } from './data';
import { useSettled } from './shared';

export interface PickedPerson {
  id: string;
  name: string;
  code: string;
}

/** How many matches the picker offers. */
const MATCHES = 8;

/**
 * Picks an active person by searching for a name, code or number, among those the viewer reaches.
 * With `none`, nobody is a choice too, such as "Nobody: top of the organisation", and `null`
 * means it.
 */
export function PersonPicker({
  label,
  value,
  onChange,
  none,
  help,
  error,
  exclude,
  designations,
}: {
  label: string;
  value: PickedPerson | null;
  onChange: (person: PickedPerson | null) => void;
  none?: string;
  help?: string;
  error?: string;
  /** Someone who can't be picked, such as the person being changed. */
  exclude?: string;
  /** Only people with one of these designations, such as those who may fill a slot. */
  designations?: readonly string[];
}) {
  const { client } = useApp();
  const { t } = useLanguage();
  const [searching, setSearching] = useState(value === null && none === undefined);
  const [q, setQ] = useState('');
  const settled = useSettled(q.trim());
  const listId = useId();
  // One designation narrows the search on the server; several, here.
  const only = designations?.length === 1 ? `&designation=${designations[0]}` : '';
  const matches = useQuery({
    queryKey: ['person-picker', settled, only],
    queryFn: () =>
      read(
        client,
        `/v1/users?status=active&limit=${MATCHES * 2}&q=${encodeURIComponent(settled)}${only}`,
        UserListResult,
      ),
    enabled: searching && settled !== '',
  });
  const found = (matches.data?.items ?? [])
    .filter((person) => person.id !== exclude)
    .filter((person) => !designations || designations.includes(person.designation))
    .slice(0, MATCHES);

  function choose(person: PickedPerson | null) {
    onChange(person);
    setSearching(false);
    setQ('');
  }

  if (!searching) {
    return (
      <div className="ks-field">
        <span className="ks-label">{label}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {value ? (
              <>
                {value.name} <code>{value.code}</code>
              </>
            ) : (
              none
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSearching(true)}>
            {t('person.change')}
          </Button>
        </div>
        {error ? (
          <p className="ks-help error" role="alert">
            {error}
          </p>
        ) : help ? (
          <p className="ks-help">{help}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={label}
        type="search"
        value={q}
        aria-controls={listId}
        help={help ?? t('people.search_help')}
        {...(error ? { error } : {})}
        onChange={(event) => setQ(event.target.value)}
      />
      <ul id={listId} className="flex flex-col items-start gap-1" aria-live="polite">
        {none !== undefined ? (
          <li>
            <Button size="sm" variant="ghost" onClick={() => choose(null)}>
              {none}
            </Button>
          </li>
        ) : null}
        {found.map((person) => (
          <li key={person.id}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => choose({ id: person.id, name: person.name, code: person.code })}
            >
              {person.name} <code>{person.code}</code>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
