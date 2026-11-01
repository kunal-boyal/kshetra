import {
  type DashboardCard,
  type DashboardCardKind,
  DashboardLayoutListResult,
  DashboardLayoutRow,
  LAYOUT_CARDS_MOST,
  TILE_METRICS_MOST,
  TREND_METRICS_MOST,
} from '@thelamp/shared';
import {
  Button,
  Checkbox,
  ChoiceGroup,
  Confirm,
  EmptyState,
  Icon,
  Notice,
  SelectField,
} from '@thelamp/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, LayoutDashboard, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, write } from '../people/data';
import { fieldErrors, PageHeader } from '../people/shared';

type Choices = DashboardLayoutListResult;

const FIXED: readonly DashboardCardKind[] = ['mix', 'leaderboard', 'on_duty', 'waiting'];

/** The standard Home as cards, a place to start a role's layout from. */
function standard(choices: Choices): DashboardCard[] {
  const adds = choices.metrics.filter((metric) => metric.additive);
  return [
    ...(choices.metrics.length
      ? [{ kind: 'tiles' as const, metrics: choices.metrics.slice(0, 4).map((m) => m.key) }]
      : []),
    ...(adds.length ? [{ kind: 'trend' as const, metrics: [adds[0]!.key] }] : []),
    { kind: 'leaderboard' },
    { kind: 'on_duty' },
    { kind: 'waiting' },
    { kind: 'mix' },
  ];
}

/** One card's settings: the metrics it shows, or how it splits one. */
function CardEditor({
  card,
  choices,
  errors,
  onChange,
}: {
  card: DashboardCard;
  choices: Choices;
  errors: Record<string, string>;
  onChange: (card: DashboardCard) => void;
}) {
  const { t, locale } = useLanguage();
  const name = (key: string) =>
    choices.metrics.find((metric) => metric.key === key)?.name[locale].other ?? key;
  if (card.kind === 'tiles' || card.kind === 'trend') {
    const offered =
      card.kind === 'trend' ? choices.metrics.filter((metric) => metric.additive) : choices.metrics;
    const most = card.kind === 'trend' ? TREND_METRICS_MOST : TILE_METRICS_MOST;
    const error = Object.entries(errors).find(([path]) => path.includes('metrics'))?.[1];
    return (
      <ChoiceGroup legend={t('dashboards.metrics', { most })} {...(error ? { error } : {})}>
        <div className="grid gap-1 sm:grid-cols-2">
          {offered.map((metric) => {
            const on = card.metrics.includes(metric.key);
            return (
              <Checkbox
                key={metric.key}
                label={name(metric.key)}
                checked={on}
                disabled={!on && card.metrics.length >= most}
                onChange={() =>
                  onChange({
                    ...card,
                    metrics: on
                      ? card.metrics.filter((key) => key !== metric.key)
                      : [...card.metrics, metric.key],
                  })
                }
              />
            );
          })}
        </div>
      </ChoiceGroup>
    );
  }
  if (card.kind === 'breakdown') {
    const offered =
      card.by === 'territory'
        ? choices.metrics.filter((metric) => metric.additive)
        : choices.metrics;
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={t('dashboards.metric')}
          value={card.metric}
          options={offered.map((metric) => ({ value: metric.key, label: name(metric.key) }))}
          {...(errors.metric ? { error: errors.metric } : {})}
          onChange={(event) => onChange({ ...card, metric: event.target.value })}
        />
        <SelectField
          label={t('dashboards.by')}
          value={card.by}
          options={[
            { value: 'person', label: t('dashboards.by_person') },
            { value: 'territory', label: t('dashboards.by_territory') },
          ]}
          onChange={(event) => {
            const by = event.target.value as 'person' | 'territory';
            onChange(
              by === 'territory'
                ? {
                    kind: 'breakdown',
                    metric: card.metric,
                    by,
                    level: card.level ?? choices.levels[0]?.key ?? '',
                  }
                : { kind: 'breakdown', metric: card.metric, by },
            );
          }}
        />
        {card.by === 'territory' ? (
          <SelectField
            label={t('dashboards.level')}
            value={card.level ?? ''}
            options={choices.levels.map((level) => ({
              value: level.key,
              label: level.name[locale].one,
            }))}
            {...(errors.level ? { error: errors.level } : {})}
            onChange={(event) => onChange({ ...card, level: event.target.value })}
          />
        ) : null}
      </div>
    );
  }
  return <p className="ks-muted">{t(`dashboards.about_${card.kind}`)}</p>;
}

/** A card made fresh, from the first metric that suits it. */
function fresh(kind: DashboardCardKind, choices: Choices): DashboardCard {
  const first = choices.metrics[0]?.key ?? '';
  const adds = choices.metrics.find((metric) => metric.additive)?.key ?? first;
  switch (kind) {
    case 'tiles':
      return { kind, metrics: first ? [first] : [] };
    case 'trend':
      return { kind, metrics: adds ? [adds] : [] };
    case 'breakdown':
      return { kind, metric: first, by: 'person' };
    default:
      return { kind } as DashboardCard;
  }
}

/** One role's Home: its cards in order, each changed, moved or taken out, then saved. */
function RoleLayout({ row, choices }: { row: DashboardLayoutRow; choices: Choices }) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const [cards, setCards] = useState<DashboardCard[] | null>(row.cards);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const errors = fieldErrors(failure);
  const role = row.role.name[locale];

  async function save(next: DashboardCard[] | null) {
    setBusy(true);
    setSaved(false);
    setFailure(undefined);
    try {
      await write(client, 'PUT', `/v1/dashboard-layouts/${row.role.id}`, DashboardLayoutRow, {
        cards: next,
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setCards(next);
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!cards) {
    return (
      <EmptyState
        icon={<Icon icon={LayoutDashboard} />}
        title={t('dashboards.standard_title', { role })}
      >
        <p>{t('dashboards.standard_body')}</p>
        <Button variant="primary" onClick={() => setCards(standard(choices))}>
          {t('dashboards.start')}
        </Button>
      </EmptyState>
    );
  }
  const errorsAt = (index: number) =>
    Object.fromEntries(
      Object.entries(errors).flatMap(([path, issue]) =>
        path.startsWith(`cards[${index}]`)
          ? [[path.slice(`cards[${index}]`.length).replace(/^\./, ''), issue]]
          : [],
      ),
    );
  const move = (index: number, by: -1 | 1) =>
    setCards((list) => {
      const next = [...(list ?? [])];
      const [card] = next.splice(index, 1);
      next.splice(index + by, 0, card!);
      return next;
    });
  const addable = (['tiles', 'trend', 'breakdown', ...FIXED] as DashboardCardKind[]).filter(
    (kind) => !FIXED.includes(kind) || !cards.some((card) => card.kind === kind),
  );

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3" aria-label={t('dashboards.cards', { role })}>
        {cards.map((card, index) => {
          const title = t(`dashboards.kind_${card.kind}`);
          const own = errorsAt(index);
          return (
            <li key={index} className="ks-card flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="heading-sm">
                  {index + 1}. {title}
                </h3>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={ArrowUp} />}
                    aria-label={t('dashboards.move_up', { card: title, place: index + 1 })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={ArrowDown} />}
                    aria-label={t('dashboards.move_down', { card: title, place: index + 1 })}
                    disabled={index === cards.length - 1}
                    onClick={() => move(index, 1)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Trash2} />}
                    aria-label={t('dashboards.remove', { card: title, place: index + 1 })}
                    onClick={() => setCards(cards.filter((_, at) => at !== index))}
                  />
                </div>
              </div>
              <CardEditor
                card={card}
                choices={choices}
                errors={own}
                onChange={(next) =>
                  setCards(cards.map((entry, at) => (at === index ? next : entry)))
                }
              />
              {own[''] ? (
                <p className="ks-help error" role="alert">
                  {own['']}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {cards.length < LAYOUT_CARDS_MOST ? (
        <SelectField
          label={t('dashboards.add')}
          none={t('dashboards.choose_card')}
          className="max-w-[20rem]"
          value=""
          options={addable.map((kind) => ({ value: kind, label: t(`dashboards.kind_${kind}`) }))}
          onChange={(event) => {
            const kind = event.target.value as DashboardCardKind;
            if (kind) setCards([...cards, fresh(kind, choices)]);
          }}
        />
      ) : null}
      {failure !== undefined && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {saved ? <Notice>{t('dashboards.saved', { role })}</Notice> : null}
      {resetting ? (
        <Confirm
          question={t('dashboards.reset_question', { role })}
          action={
            <Button
              variant="danger"
              onClick={() => {
                setResetting(false);
                void save(null);
              }}
            >
              {t('dashboards.reset')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setResetting(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Icon icon={Save} />}
          disabled={busy || cards.length === 0}
          onClick={() => void save(cards)}
        >
          {t('dashboards.save')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setResetting(true)}>
          {t('dashboards.reset')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings › Dashboards (M18, decision D122): each role's Home as cards in order. Every card
 * follows the viewer's own scope and permissions; a role without a layout keeps the standard Home.
 */
export function DashboardsPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const layouts = useQuery({
    queryKey: ['dashboard-layouts'],
    queryFn: () => read(client, '/v1/dashboard-layouts', DashboardLayoutListResult),
  });
  const [roleId, setRoleId] = useState<string>();
  const rows = layouts.data?.items ?? [];
  const row = rows.find((entry) => entry.role.id === roleId) ?? rows[0];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('dashboards.title')} intro={t('dashboards.intro')} />
      {layouts.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(layouts.error, t)}
        </p>
      ) : !layouts.data || !row ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <SelectField
            label={t('dashboards.role')}
            className="max-w-[20rem]"
            value={row.role.id}
            options={rows.map((entry) => ({
              value: entry.role.id,
              label: entry.cards
                ? t('dashboards.role_laid_out', { role: entry.role.name[locale] })
                : entry.role.name[locale],
            }))}
            onChange={(event) => setRoleId(event.target.value)}
          />
          <RoleLayout key={row.role.id} row={row} choices={layouts.data} />
        </>
      )}
    </div>
  );
}
