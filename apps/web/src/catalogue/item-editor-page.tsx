import { type ItemResult, type MeasureType, newId } from '@thelamp/shared';
import { Button, Checkbox, Icon, SelectField, TextField } from '@thelamp/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { CustomFieldInputs, type Values } from '../people/custom-fields';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { useCatalogue, useCatalogueWrites } from './data';

interface ItemDraft {
  code: string;
  name: string;
  productName: string;
  categoryName: string;
  packLabel: string;
  hsn: string;
  taxRate: string;
  mrp: string;
  baseUnit: string;
  /** How many base units each other unit holds, by unit key; blank when not sold in it. */
  factors: Record<string, string>;
  measureType: string;
  measurePerBaseUnit: string;
  active: boolean;
  custom: Values;
}

/** A stored decimal as typed: `20.000` reads as `20`. */
const plain = (value: string | null) => (value === null ? '' : String(Number(value)));

function draftOf(item: ItemResult | undefined, baseUnit: string): ItemDraft {
  return {
    code: item?.code ?? '',
    name: item?.name ?? '',
    productName: item?.product.name ?? '',
    categoryName: item?.category?.name ?? '',
    packLabel: item?.packLabel ?? '',
    hsn: item?.hsn ?? '',
    taxRate: item ? plain(item.taxRate) : '',
    mrp: item?.mrp ?? '',
    baseUnit: item?.baseUnit ?? baseUnit,
    factors: Object.fromEntries(
      (item?.units ?? [])
        .filter((unit) => unit.key !== item?.baseUnit)
        .map((unit) => [unit.key, plain(unit.factor)]),
    ),
    measureType: item?.measureType ?? '',
    measurePerBaseUnit: item ? plain(item.measurePerBaseUnit) : '',
    active: item?.active ?? true,
    custom: item?.custom ?? {},
  };
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

/**
 * One item (spec 5.11, decision D77): its code, names, product and category, pack and tax, the
 * units it is sold in with how many base units each holds, its measure for volume totals, and the
 * catalogue's item fields. The measure must agree with the pack label (BR-16).
 */
export function ItemEditorPage({ itemId }: { itemId?: string }) {
  const { t } = useLanguage();
  const catalogue = useCatalogue();
  if (catalogue.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(catalogue.error, t)}
      </p>
    );
  }
  if (!catalogue.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const item = itemId ? catalogue.data.items.find((entry) => entry.id === itemId) : undefined;
  if (itemId && !item) return <p className="ks-muted">{t('catalogue.item_not_found')}</p>;
  return <Editor key={itemId ?? 'new'} item={item} />;
}

function Editor({ item }: { item: ItemResult | undefined }) {
  const { t, locale } = useLanguage();
  const { client, queryClient } = useApp();
  const config = useConfig(client, queryClient);
  const navigate = useNavigate();
  const writes = useCatalogueWrites();
  const units = config.data?.bundle.catalogue.units ?? [];
  const measureTypes = config.data?.bundle.catalogue.measureTypes ?? [];
  const itemFields = config.data?.bundle.catalogue.itemFields ?? [];
  const [id] = useState(() => item?.id ?? newId());
  const [draft, setDraft] = useState(() =>
    draftOf(item, units.find((unit) => unit.base)?.key ?? ''),
  );
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(failure);
  const at = (path: string) => (errors[path] ? { error: errors[path] } : {});
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const unitName = (key: string, form: 'one' | 'other') =>
    units.find((unit) => unit.key === key)?.name[locale][form] ?? key;
  const others = units.filter((unit) => unit.key !== draft.baseUnit);
  const sold = others.filter((unit) => (draft.factors[unit.key] ?? '').trim() !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      await writes.saveItem(id, {
        code: draft.code.trim(),
        name: draft.name.trim(),
        productName: draft.productName.trim(),
        categoryName: orNull(draft.categoryName),
        packLabel: orNull(draft.packLabel),
        hsn: orNull(draft.hsn),
        taxRate: draft.taxRate.trim(),
        mrp: orNull(draft.mrp),
        baseUnit: draft.baseUnit,
        units: sold.map((unit) => ({ key: unit.key, factor: draft.factors[unit.key]!.trim() })),
        measureType: (orNull(draft.measureType) as MeasureType | null) ?? null,
        measurePerBaseUnit: orNull(draft.measurePerBaseUnit),
        custom: draft.custom,
        active: draft.active,
      });
      await navigate({ to: '/settings/catalogue' });
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  }

  const unitIndex = (key: string) => sold.findIndex((unit) => unit.key === key);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={item ? item.name : t('catalogue.new_item')}
        back={{ to: '/settings/catalogue', label: t('catalogue.title') }}
      />
      <form className="flex flex-col gap-6" noValidate onSubmit={(event) => void submit(event)}>
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {errorMessage(failure, t)}
          </p>
        ) : null}
        <Section title={t('catalogue.what_it_is')}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('catalogue.code')}
              required
              value={draft.code}
              {...at('code')}
              onChange={(event) => set('code', event.target.value)}
            />
            <TextField
              label={t('catalogue.name')}
              required
              value={draft.name}
              {...at('name')}
              onChange={(event) => set('name', event.target.value)}
            />
            <TextField
              label={t('catalogue.product')}
              help={t('catalogue.product_help')}
              required
              value={draft.productName}
              {...at('productName')}
              onChange={(event) => set('productName', event.target.value)}
            />
            <TextField
              label={t('catalogue.category')}
              value={draft.categoryName}
              {...at('categoryName')}
              onChange={(event) => set('categoryName', event.target.value)}
            />
            <TextField
              label={t('catalogue.pack')}
              help={t('catalogue.pack_help')}
              value={draft.packLabel}
              {...at('packLabel')}
              onChange={(event) => set('packLabel', event.target.value)}
            />
            <TextField
              label={t('catalogue.hsn')}
              value={draft.hsn}
              {...at('hsn')}
              onChange={(event) => set('hsn', event.target.value)}
            />
            <TextField
              label={t('catalogue.tax_rate_percent')}
              required
              numeric
              inputMode="decimal"
              value={draft.taxRate}
              {...at('taxRate')}
              onChange={(event) => set('taxRate', event.target.value)}
            />
            <TextField
              label={t('catalogue.mrp')}
              help={t('catalogue.mrp_help')}
              numeric
              inputMode="decimal"
              value={draft.mrp}
              {...at('mrp')}
              onChange={(event) => set('mrp', event.target.value)}
            />
          </div>
        </Section>

        <Section title={t('catalogue.units')}>
          <SelectField
            label={t('catalogue.base_unit')}
            help={t('catalogue.base_unit_help')}
            value={draft.baseUnit}
            options={units.map((unit) => ({ value: unit.key, label: unit.name[locale].one }))}
            {...at('baseUnit')}
            onChange={(event) => set('baseUnit', event.target.value)}
          />
          {others.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {others.map((unit) => (
                <TextField
                  key={unit.key}
                  label={t('catalogue.factor', {
                    unit: unit.name[locale].one,
                    base: unitName(draft.baseUnit, 'other'),
                  })}
                  help={t('catalogue.factor_help')}
                  numeric
                  inputMode="decimal"
                  value={draft.factors[unit.key] ?? ''}
                  {...at(`units.${unitIndex(unit.key)}.factor`)}
                  onChange={(event) =>
                    set('factors', { ...draft.factors, [unit.key]: event.target.value })
                  }
                />
              ))}
            </div>
          ) : null}
          {measureTypes.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label={t('catalogue.measure_type')}
                none={t('catalogue.no_measure')}
                value={draft.measureType}
                options={measureTypes.map((type) => ({ value: type, label: type }))}
                {...at('measureType')}
                onChange={(event) => set('measureType', event.target.value)}
              />
              <TextField
                label={t('catalogue.measure_per_unit', { base: unitName(draft.baseUnit, 'one') })}
                numeric
                inputMode="decimal"
                disabled={draft.measureType === ''}
                value={draft.measurePerBaseUnit}
                {...at('measurePerBaseUnit')}
                onChange={(event) => set('measurePerBaseUnit', event.target.value)}
              />
            </div>
          ) : null}
        </Section>

        {itemFields.length > 0 ? (
          <Section title={t('catalogue.more')}>
            <CustomFieldInputs
              fields={itemFields}
              values={draft.custom}
              errors={errors}
              onChange={(key, value) => set('custom', { ...draft.custom, [key]: value })}
            />
          </Section>
        ) : null}

        <Checkbox
          label={t('catalogue.active')}
          detail={t('catalogue.active_help')}
          checked={draft.active}
          onChange={(event) => set('active', event.target.checked)}
        />
        <div>
          <Button type="submit" variant="primary" busy={busy} icon={<Icon icon={Save} />}>
            {item ? t('common.save') : t('catalogue.add_item')}
          </Button>
        </div>
      </form>
    </div>
  );
}
