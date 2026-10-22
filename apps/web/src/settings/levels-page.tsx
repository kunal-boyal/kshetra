import { type TerritoryLevel, TerritoryLevelsResult, TerritoryListResult } from '@kshetra/shared';
import { Button, Icon, Notice, TextField } from '@kshetra/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

interface LevelDraft {
  key: string;
  oneEn: string;
  otherEn: string;
  oneHi: string;
  otherHi: string;
}

const MAX_LEVELS = 6;

function draftOf(level: TerritoryLevel): LevelDraft {
  return {
    key: level.key,
    oneEn: level.name.en.one,
    otherEn: level.name.en.other,
    oneHi: level.name.hi.one,
    otherHi: level.name.hi.other,
  };
}

/**
 * Territory levels (M2, spec 5.4): the names of each level of the tree, top first. A level keeps
 * its place and key once added, as territories sit at it; new levels go at the bottom.
 */
export function LevelsPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const tree = useQuery({
    queryKey: ['territories', 'tree'],
    queryFn: () => read(client, '/v1/territories', TerritoryListResult),
  });
  if (tree.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(tree.error, t)}
      </p>
    );
  }
  if (!tree.data) return <p className="ks-muted">{t('common.loading')}</p>;
  return <Editor levels={tree.data.levels} />;
}

function Editor({ levels }: { levels: readonly TerritoryLevel[] }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState(() => levels.map(draftOf));
  const [failure, setFailure] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const change = (index: number, patch: Partial<LevelDraft>) =>
    setDrafts(drafts.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    setSaved(false);
    try {
      const result = await write(client, 'PUT', '/v1/territories/levels', TerritoryLevelsResult, {
        levels: drafts.map((draft) => ({
          key: draft.key.trim(),
          name: {
            en: { one: draft.oneEn.trim(), other: draft.otherEn.trim() },
            hi: {
              one: draft.oneHi.trim() || draft.oneEn.trim(),
              other: draft.otherHi.trim() || draft.otherEn.trim(),
            },
          },
        })),
      });
      if (result) setDrafts(result.levels.map(draftOf));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['territories'] }),
        queryClient.invalidateQueries({ queryKey: ['config'] }),
      ]);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('levels.title')} intro={t('levels.intro')} />
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
        {saved ? <Notice>{t('common.saved')}</Notice> : null}
        {failure !== undefined ? (
          <div className="ks-help error" role="alert">
            <p>{errorMessage(failure, t)}</p>
            <ul>
              {Object.entries(errors).map(([path, issue]) => (
                <li key={path}>
                  <code>{path}</code>: {issue}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ol className="flex flex-col gap-4">
          {drafts.map((draft, index) => {
            const added = index >= levels.length;
            return (
              <li key={index} className="ks-card flex flex-col gap-3">
                <h2 className="heading-sm">{t('levels.level', { level: String(index + 1) })}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label={t('types.key')}
                    help={added ? t('levels.key_help') : t('levels.key_kept')}
                    required
                    readOnly={!added}
                    value={draft.key}
                    {...at(`levels[${index}].key`)}
                    onChange={(event) => change(index, { key: event.target.value })}
                  />
                  <span />
                  <TextField
                    label={t('types.one_en')}
                    required
                    value={draft.oneEn}
                    {...at(`levels[${index}].name.en.one`)}
                    onChange={(event) => change(index, { oneEn: event.target.value })}
                  />
                  <TextField
                    label={t('types.other_en')}
                    required
                    value={draft.otherEn}
                    {...at(`levels[${index}].name.en.other`)}
                    onChange={(event) => change(index, { otherEn: event.target.value })}
                  />
                  <TextField
                    label={t('types.one_hi')}
                    value={draft.oneHi}
                    onChange={(event) => change(index, { oneHi: event.target.value })}
                  />
                  <TextField
                    label={t('types.other_hi')}
                    value={draft.otherHi}
                    onChange={(event) => change(index, { otherHi: event.target.value })}
                  />
                </div>
                {added ? (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Icon icon={Trash2} size="sm" />}
                      onClick={() => setDrafts(drafts.filter((_, at) => at !== index))}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2">
          {drafts.length < MAX_LEVELS ? (
            <Button
              icon={<Icon icon={Plus} />}
              onClick={() =>
                setDrafts([...drafts, { key: '', oneEn: '', otherEn: '', oneHi: '', otherHi: '' }])
              }
            >
              {t('levels.add')}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {t('levels.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
