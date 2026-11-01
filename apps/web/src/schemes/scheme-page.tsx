import { formatMoney, formatNumber } from '@thelamp/i18n';
import {
  afterScheme,
  newId,
  priceLine,
  SCHEME_KINDS,
  type SchemeKindValue,
  type SchemeResult,
  schemeBenefit,
  type SchemeSlab,
  todayIn,
} from '@thelamp/shared';
import { Button, Checkbox, ChoiceGroup, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useCatalogue } from '../catalogue/data';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess, useTerritories } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useTypeList } from '../settings/types-data';
import { useSaveScheme, useSchemes } from './data';
import { useGives } from './shared';

interface Draft {
  key: string;
  nameEn: string;
  nameHi: string;
  kind: SchemeKindValue;
  percent: string;
  amount: string;
  slabs: SchemeSlab[];
  buy: string;
  get: string;
  freeItemId: string;
  itemIds: string[];
  categoryIds: string[];
  accountTypeKeys: string[];
  territoryIds: string[];
  validFrom: string;
  validTo: string;
  active: boolean;
}

const DECIMAL = /^\d{1,9}(?:\.\d{1,2})?$/;

/**
 * One scheme (M10, BR-55, decision D127): what it gives, by kind, whom it reaches and when, with
 * an example line worked out by the same rules orders use. Its key never changes; every change is
 * made at the version the editor saw.
 */
export function SchemePage({ schemeId }: { schemeId?: string }) {
  const { t, locale } = useLanguage();
  const schemes = useSchemes();
  const scheme = schemes.data?.find((entry) => entry.id === schemeId);
  if (schemeId && schemes.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(schemes.error, t)}
      </p>
    );
  }
  if (schemeId && !schemes.data) return <p className="ks-muted">{t('common.loading')}</p>;
  if (schemeId && !scheme) {
    return (
      <p className="ks-help error" role="alert">
        {t('schemes.not_found')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={scheme ? scheme.name[locale] : t('schemes.new')}
        back={{ to: '/settings/schemes', label: t('schemes.title') }}
      />
      <Editor key={scheme?.version ?? 'new'} scheme={scheme} />
    </div>
  );
}

function Editor({ scheme }: { scheme: SchemeResult | undefined }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const navigate = useNavigate();
  const save = useSaveScheme();
  const catalogue = useCatalogue();
  const types = useTypeList();
  const territories = useTerritories();
  const gives = useGives();
  const [id] = useState(() => scheme?.id ?? newId());
  const [draft, setDraft] = useState<Draft>(() => ({
    key: scheme?.key ?? '',
    nameEn: scheme?.name.en ?? '',
    nameHi: scheme?.name.hi ?? '',
    kind: scheme?.kind ?? 'percentage',
    percent: scheme?.rule.percent ?? '',
    amount: scheme?.rule.amount ?? '',
    slabs: [...(scheme?.rule.slabs ?? [{ from: '', percent: '' }])],
    buy: scheme?.rule.buy ?? '',
    get: scheme?.rule.get ?? '',
    freeItemId: scheme?.rule.freeItemId ?? '',
    itemIds: [...(scheme?.itemIds ?? [])],
    categoryIds: [...(scheme?.categoryIds ?? [])],
    accountTypeKeys: [...(scheme?.accountTypeKeys ?? [])],
    territoryIds: [...(scheme?.territoryIds ?? [])],
    validFrom: scheme?.validFrom ?? todayIn(access.timezone),
    validTo: scheme?.validTo ?? '',
    active: scheme?.active ?? true,
  }));
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const rule = () => {
    switch (draft.kind) {
      case 'percentage':
        return { percent: draft.percent.trim() };
      case 'flat_per_unit':
        return { amount: draft.amount.trim() };
      case 'slabs':
        return {
          slabs: draft.slabs.map((slab) => ({
            from: slab.from.trim(),
            percent: slab.percent.trim(),
          })),
        };
      case 'free_goods':
        return {
          buy: draft.buy.trim(),
          get: draft.get.trim(),
          freeItemId: draft.freeItemId || null,
        };
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await save(id, {
        key: draft.key.trim(),
        name: { en: draft.nameEn.trim(), hi: draft.nameHi.trim() || draft.nameEn.trim() },
        kind: draft.kind,
        rule: rule(),
        itemIds: draft.itemIds,
        categoryIds: draft.categoryIds,
        accountTypeKeys: draft.accountTypeKeys,
        territoryIds: draft.territoryIds,
        validFrom: draft.validFrom,
        validTo: draft.validTo || null,
        active: draft.active,
        ...(scheme ? { version: scheme.version } : {}),
      });
      if (scheme) setSaved(true);
      else await navigate({ to: '/settings/schemes/$schemeId', params: { schemeId: id } });
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  const items = (catalogue.data?.items ?? []).filter((item) => item.active);
  const categories = [
    ...new Map(
      items.flatMap((item) => (item.category ? [[item.category.id, item.category.name]] : [])),
    ),
  ].map(([value, label]) => ({ value, label }));
  // Problems with one slab show on its field; the group shows those of the slabs as a whole.
  const ruleIssue = errors['rule.slabs'];

  return (
    <form noValidate className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <Section title={t('schemes.what')}>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label={t('schemes.key')}
            help={t('schemes.key_help')}
            required
            disabled={scheme !== undefined}
            value={draft.key}
            {...at('key')}
            onChange={(event) => set('key', event.target.value)}
          />
          <TextField
            label={t('schemes.name_en')}
            required
            value={draft.nameEn}
            {...at('name.en')}
            onChange={(event) => set('nameEn', event.target.value)}
          />
          <TextField
            label={t('schemes.name_hi')}
            value={draft.nameHi}
            {...at('name.hi')}
            onChange={(event) => set('nameHi', event.target.value)}
          />
        </div>
        <SelectField
          label={t('schemes.kind')}
          className="max-w-sm"
          value={draft.kind}
          options={SCHEME_KINDS.map((kind) => ({ value: kind, label: t(`scheme.kind_${kind}`) }))}
          onChange={(event) => set('kind', event.target.value as SchemeKindValue)}
        />
        {draft.kind === 'percentage' ? (
          <TextField
            label={t('schemes.percent')}
            className="max-w-xs"
            numeric
            inputMode="decimal"
            required
            value={draft.percent}
            {...at('rule.percent')}
            onChange={(event) => set('percent', event.target.value)}
          />
        ) : draft.kind === 'flat_per_unit' ? (
          <TextField
            label={t('schemes.amount')}
            help={t('schemes.amount_help')}
            className="max-w-xs"
            numeric
            inputMode="decimal"
            required
            value={draft.amount}
            {...at('rule.amount')}
            onChange={(event) => set('amount', event.target.value)}
          />
        ) : draft.kind === 'slabs' ? (
          <ChoiceGroup legend={t('schemes.slabs')} {...(ruleIssue ? { error: ruleIssue } : {})}>
            <p className="ks-help">{t('schemes.slabs_help')}</p>
            {draft.slabs.map((slab, index) => (
              <div key={index} className="flex flex-wrap items-end gap-3">
                <TextField
                  label={t('schemes.slab_from', { number: index + 1 })}
                  numeric
                  inputMode="decimal"
                  value={slab.from}
                  {...at(`rule.slabs.${index}.from`)}
                  onChange={(event) =>
                    set(
                      'slabs',
                      draft.slabs.map((entry, at) =>
                        at === index ? { ...entry, from: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <TextField
                  label={t('schemes.slab_percent', { number: index + 1 })}
                  numeric
                  inputMode="decimal"
                  value={slab.percent}
                  {...at(`rule.slabs.${index}.percent`)}
                  onChange={(event) =>
                    set(
                      'slabs',
                      draft.slabs.map((entry, at) =>
                        at === index ? { ...entry, percent: event.target.value } : entry,
                      ),
                    )
                  }
                />
                {draft.slabs.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<Icon icon={Trash2} />}
                    onClick={() =>
                      set(
                        'slabs',
                        draft.slabs.filter((_, at) => at !== index),
                      )
                    }
                  >
                    {t('schemes.remove_slab', { number: index + 1 })}
                  </Button>
                ) : null}
              </div>
            ))}
            {draft.slabs.length < 10 ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                icon={<Icon icon={Plus} />}
                onClick={() => set('slabs', [...draft.slabs, { from: '', percent: '' }])}
              >
                {t('schemes.add_slab')}
              </Button>
            ) : null}
          </ChoiceGroup>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label={t('schemes.buy')}
              numeric
              inputMode="decimal"
              required
              value={draft.buy}
              {...at('rule.buy')}
              onChange={(event) => set('buy', event.target.value)}
            />
            <TextField
              label={t('schemes.get')}
              numeric
              inputMode="decimal"
              required
              value={draft.get}
              {...at('rule.get')}
              onChange={(event) => set('get', event.target.value)}
            />
            <SelectField
              label={t('schemes.free_item')}
              value={draft.freeItemId}
              none={t('schemes.free_same_item')}
              options={items.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.code})`,
              }))}
              {...at('rule.freeItemId')}
              onChange={(event) => set('freeItemId', event.target.value)}
            />
          </div>
        )}
        <Example draft={draft} rule={rule()} />
        <p className="ks-meta">{gives({ kind: draft.kind, rule: rule() })}</p>
      </Section>

      <Section title={t('schemes.whom')}>
        <p className="ks-help">{t('schemes.whom_help')}</p>
        <CheckList
          legend={t('schemes.items')}
          searchLabel={t('schemes.find_item')}
          options={items.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }))}
          value={draft.itemIds}
          error={Object.entries(errors).find(([path]) => path.startsWith('itemIds'))?.[1]}
          onChange={(value) => set('itemIds', value)}
        />
        <CheckList
          legend={t('schemes.categories')}
          options={categories}
          value={draft.categoryIds}
          error={Object.entries(errors).find(([path]) => path.startsWith('categoryIds'))?.[1]}
          onChange={(value) => set('categoryIds', value)}
        />
        <CheckList
          legend={t('schemes.account_types')}
          options={(types.data ?? []).map((type) => ({
            value: type.key,
            label: type.name[locale].other,
          }))}
          value={draft.accountTypeKeys}
          error={Object.entries(errors).find(([path]) => path.startsWith('accountTypeKeys'))?.[1]}
          onChange={(value) => set('accountTypeKeys', value)}
        />
        <CheckList
          legend={t('schemes.territories')}
          searchLabel={t('prices.find_territory')}
          options={(territories.data ?? [])
            .filter((node) => node.active)
            .map((node) => ({ value: node.id, label: `${node.name} (${node.code})` }))}
          value={draft.territoryIds}
          error={Object.entries(errors).find(([path]) => path.startsWith('territoryIds'))?.[1]}
          onChange={(value) => set('territoryIds', value)}
        />
      </Section>

      <Section title={t('schemes.when')}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('prices.valid_from')}
            type="date"
            required
            value={draft.validFrom}
            {...at('validFrom')}
            onChange={(event) => set('validFrom', event.target.value)}
          />
          <TextField
            label={t('prices.valid_to')}
            help={t('prices.valid_to_help')}
            type="date"
            value={draft.validTo}
            {...at('validTo')}
            onChange={(event) => set('validTo', event.target.value)}
          />
        </div>
        <Checkbox
          label={t('catalogue.active')}
          checked={draft.active}
          onChange={(event) => set('active', event.target.checked)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {scheme ? t('common.save') : t('schemes.add')}
          </Button>
          {saved ? (
            <p className="ks-muted" role="status">
              {t('schemes.saved')}
            </p>
          ) : null}
        </div>
      </Section>
    </form>
  );
}

/** A line worked out by the scheme as typed, by the same rules orders use (BR-55). */
function Example({
  draft,
  rule,
}: {
  draft: Draft;
  rule: Parameters<typeof schemeBenefit>[0]['rule'];
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const [units, setUnits] = useState('100');
  const [rate, setRate] = useState('100');
  const money = (value: string) =>
    formatMoney(value as `${number}`, { locale, currency: access.currency });
  let outcome: string | null = null;
  if (DECIMAL.test(units.trim()) && DECIMAL.test(rate.trim())) {
    // A rule half typed can't be read yet; the example waits for it.
    try {
      const { taxable } = priceLine({
        price: rate.trim(),
        discount: '0',
        taxRate: '0',
        quantity: units.trim(),
        factor: '1',
      });
      const benefit = schemeBenefit(
        {
          id: 'example',
          key: 'example',
          kind: draft.kind,
          rule,
          itemIds: [],
          categoryIds: [],
          accountTypeKeys: [],
          territoryIds: [],
          validFrom: draft.validFrom,
          validTo: null,
          active: true,
        },
        { itemId: 'example', categoryId: null, baseUnits: units.trim(), taxable },
        units.trim(),
      );
      outcome = benefit.free
        ? t('schemes.example_free', {
            units: formatNumber(Number(benefit.free.baseUnits), { locale }),
          })
        : t('schemes.example_off', {
            discount: money(benefit.discount),
            taxable: money(afterScheme({ taxable }, benefit.discount, '0').taxable),
          });
    } catch {
      outcome = null;
    }
  }
  return (
    <div className="ks-card flex flex-col gap-3" aria-label={t('schemes.example')}>
      <p className="font-semibold">{t('schemes.example')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('schemes.example_units')}
          numeric
          inputMode="decimal"
          value={units}
          onChange={(event) => setUnits(event.target.value)}
        />
        <TextField
          label={t('schemes.example_rate')}
          numeric
          inputMode="decimal"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
        />
      </div>
      <p role="status">{outcome ?? t('schemes.example_waiting')}</p>
    </div>
  );
}

/** A choice of many, found by part of its name when the list is long. */
function CheckList({
  legend,
  searchLabel,
  options,
  value,
  error,
  onChange,
}: {
  legend: string;
  searchLabel?: string;
  options: { value: string; label: string }[];
  value: string[];
  error?: string | undefined;
  onChange: (value: string[]) => void;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = options.filter(
    (option) =>
      value.includes(option.value) || !needle || option.label.toLowerCase().includes(needle),
  );
  return (
    <ChoiceGroup legend={legend} {...(error ? { error } : {})}>
      {searchLabel && options.length > 12 ? (
        <TextField
          label={searchLabel}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      {options.length === 0 ? <p className="ks-muted">{t('schemes.none_to_choose')}</p> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {shown.slice(0, 60).map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={value.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, option.value]
                  : value.filter((entry) => entry !== option.value),
              )
            }
          />
        ))}
      </div>
    </ChoiceGroup>
  );
}
