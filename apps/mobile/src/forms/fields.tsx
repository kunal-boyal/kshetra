import { radius, size, spacing } from '@thelamp/design-tokens';
import {
  conditionHolds,
  type FormField,
  type GroupItemField,
  type ProductLine,
  type Values,
} from '@thelamp/forms';
import type {
  CatalogueUnitView,
  Locale,
  SyncAccount,
  SyncContact,
  SyncItem,
} from '@thelamp/shared';
import {
  Button,
  Card,
  CheckGroup,
  ChipGroup,
  ChoiceGroup,
  Icon,
  Notice,
  PhotoStrip,
  Text,
  TextField,
  useTheme,
} from '@thelamp/ui-mobile';
import { Camera, Clock, Minus, Plus, ScanLine, Star, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';
import { PickList } from './pick-list';

type Field = FormField | GroupItemField;
type ValueField = Exclude<Field, { type: 'section' } | { type: 'info_text' }>;

/** What the fields read beyond the form: the phone's copies, and how to open the camera. */
export interface EntryData {
  accounts: readonly SyncAccount[];
  contacts: readonly SyncContact[];
  items: readonly SyncItem[];
  units: readonly CatalogueUnitView[];
  /** The account the entry is linked to, whose contacts a contact picker offers. */
  accountId: string | null;
  /** The capture date on the tenant's clock, `YYYY-MM-DD`. */
  today: string;
  /** The time now on the tenant's clock, `HH:MM`. */
  now: string;
  /** Opens the camera, or the scanner, for the field at this path. */
  capture: (what: 'photo' | 'scan', path: string) => void;
  readOnly: boolean;
}

/** The fields a list shows: a hidden section hides those under it, as the server judges. */
export function shownFields(fields: readonly Field[], seen: Values): Field[] {
  const shown: Field[] = [];
  let sectionShown = true;
  for (const field of fields) {
    if (field.type === 'section') {
      sectionShown = !field.visibleWhen || conditionHolds(field.visibleWhen, seen);
      if (sectionShown) shown.push(field);
      continue;
    }
    if (!sectionShown) continue;
    if (field.visibleWhen && !conditionHolds(field.visibleWhen, seen)) continue;
    shown.push(field);
  }
  return shown;
}

/**
 * A list of fields as the person fills them (spec 5.6, 8.1 Form): each with the input its type
 * needs, shown while its condition holds, with its problem under it. Inside a repeating group,
 * `outer` holds the form's values, which conditions there may read too.
 */
export function FieldList({
  fields,
  values,
  onChange,
  issues,
  data,
  prefix = '',
  outer = {},
}: {
  fields: readonly Field[];
  values: Values;
  onChange: (values: Values) => void;
  /** Problems by path, such as `notes` or `visits[0].notes`, already in the reader's words. */
  issues: ReadonlyMap<string, string>;
  data: EntryData;
  prefix?: string;
  outer?: Values;
}) {
  return (
    <View style={styles.list}>
      {shownFields(fields, { ...outer, ...values }).map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => {
            const next = { ...values };
            if (value === undefined) delete next[field.key];
            else next[field.key] = value;
            onChange(next);
          }}
          issues={issues}
          data={data}
          path={`${prefix}${field.key}`}
          outer={{ ...outer, ...values }}
        />
      ))}
    </View>
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isEmpty = (value: string) => value.trim() === '';

function FieldInput({
  field,
  value,
  onChange,
  issues,
  data,
  path,
  outer,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  issues: ReadonlyMap<string, string>;
  data: EntryData;
  path: string;
  outer: Values;
}) {
  const { t, locale } = useLanguage();
  if (field.type === 'section') {
    return (
      <Text variant="headingMd" role="heading">
        {field.label[locale]}
      </Text>
    );
  }
  if (field.type === 'info_text') return <Notice>{field.text[locale]}</Notice>;
  const error = issues.get(path);
  const common = {
    // Field keys never change, so end-to-end flows find inputs by them (decision D68).
    testID: `field-${field.key}`,
    label: field.label[locale],
    required: field.required,
    ...(field.help ? { help: field.help[locale] } : {}),
    ...(error ? { error } : {}),
    editable: !data.readOnly,
  };
  const blank = (raw: string) => (isEmpty(raw) ? undefined : raw);
  switch (field.type) {
    case 'short_text':
      return (
        <TextField
          {...common}
          value={text(value)}
          maxLength={field.maxLength}
          onChangeText={(raw) => onChange(blank(raw))}
        />
      );
    case 'long_text':
      return (
        <TextField
          {...common}
          value={text(value)}
          multiline
          numberOfLines={4}
          maxLength={field.maxLength}
          onChangeText={(raw) => onChange(blank(raw))}
        />
      );
    case 'number':
      return <NumberInput common={common} field={field} value={value} onChange={onChange} />;
    case 'currency':
      return (
        <TextField
          {...common}
          numeric
          keyboardType="decimal-pad"
          value={text(value)}
          onChangeText={(raw) => onChange(blank(raw.replace(/,/g, '')))}
        />
      );
    case 'date':
      return (
        <WithShortcut
          input={
            <TextField
              {...common}
              value={text(value)}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              onChangeText={(raw) => onChange(blank(raw))}
            />
          }
          shortcut="today"
          readOnly={data.readOnly}
          onShortcut={() => onChange(data.today)}
        />
      );
    case 'time':
      return (
        <WithShortcut
          input={
            <TextField
              {...common}
              value={text(value)}
              placeholder="HH:MM"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              onChangeText={(raw) => onChange(blank(raw))}
            />
          }
          shortcut="now"
          readOnly={data.readOnly}
          onShortcut={() => onChange(data.now)}
        />
      );
    case 'single_select':
    case 'multi_select':
      return (
        <SelectInput field={field} value={value} onChange={onChange} data={data} error={error} />
      );
    case 'yes_no':
      return (
        <Labelled error={error}>
          <ChoiceGroup
            title={choiceTitle(field, locale)}
            value={value === true ? 'yes' : value === false ? 'no' : ''}
            choices={[
              { value: 'yes', label: t('common.yes') },
              { value: 'no', label: t('common.no') },
            ]}
            onChange={(chosen) => !data.readOnly && onChange(chosen === 'yes')}
          />
        </Labelled>
      );
    case 'rating':
      return (
        <Rating
          title={choiceTitle(field, locale)}
          value={typeof value === 'number' ? value : 0}
          onChange={(stars) => !data.readOnly && onChange(stars)}
          error={error}
        />
      );
    case 'photo':
      return (
        <Capture
          title={choiceTitle(field, locale)}
          kind="photo"
          done={typeof value === 'string'}
          onCapture={() => data.capture('photo', path)}
          onClear={() => onChange(undefined)}
          readOnly={data.readOnly}
          error={error}
        />
      );
    case 'barcode':
      return (
        <WithShortcut
          input={
            <TextField
              {...common}
              value={text(value)}
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={(raw) => onChange(blank(raw))}
            />
          }
          shortcut="scan"
          readOnly={data.readOnly}
          onShortcut={() => data.capture('scan', path)}
        />
      );
    case 'account_picker':
      return (
        <Labelled error={error}>
          <AccountPick
            title={choiceTitle(field, locale)}
            types={field.accountTypes}
            accounts={data.accounts}
            value={text(value)}
            onChange={(id) => !data.readOnly && onChange(id)}
          />
        </Labelled>
      );
    case 'contact_picker':
      return (
        <ContactPick
          title={choiceTitle(field, locale)}
          data={data}
          value={text(value)}
          onChange={(id) => !data.readOnly && onChange(id)}
          error={error}
        />
      );
    case 'product_lines':
      return (
        <ItemLines
          field={field}
          lines={Array.isArray(value) ? (value as ProductLine[]) : []}
          onChange={(lines) => onChange(lines.length > 0 ? lines : undefined)}
          data={data}
          issues={issues}
          path={path}
        />
      );
    case 'repeating_group':
      return (
        <Group
          field={field}
          entries={Array.isArray(value) ? (value as Values[]) : []}
          onChange={(entries) => onChange(entries.length > 0 ? entries : undefined)}
          data={data}
          issues={issues}
          path={path}
          outer={outer}
        />
      );
  }
}

/** A choice's heading: its label, marked when required. */
function choiceTitle(field: ValueField, locale: Locale): string {
  return field.required ? `${field.label[locale]} *` : field.label[locale];
}

/** A problem under a group of choices, announced as it appears. */
function Labelled({ error, children }: { error: string | undefined; children: React.ReactNode }) {
  return (
    <View style={styles.stack}>
      {children}
      {error ? (
        <Text variant="bodySm" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** An input with a button that fills it: today's date, the time now, or a scan. */
function WithShortcut({
  input,
  shortcut,
  onShortcut,
  readOnly,
}: {
  input: React.ReactNode;
  shortcut: 'today' | 'now' | 'scan';
  onShortcut: () => void;
  readOnly: boolean;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.stack}>
      {input}
      {readOnly ? null : (
        <Button
          variant="secondary"
          icon={shortcut === 'scan' ? ScanLine : Clock}
          label={t(`entry.${shortcut}`)}
          onPress={onShortcut}
        />
      )}
    </View>
  );
}

/** A number typed as text, kept as a number once it reads as one, so conditions compare it. */
function NumberInput({
  common,
  field,
  value,
  onChange,
}: {
  common: Omit<React.ComponentProps<typeof TextField>, 'value' | 'onChangeText'>;
  field: Extract<Field, { type: 'number' }>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { locale } = useLanguage();
  const [typed, setTyped] = useState(() =>
    typeof value === 'number' ? String(value) : text(value),
  );
  return (
    <TextField
      {...common}
      {...(field.unit && !common.error
        ? { help: [common.help, field.unit[locale]].filter(Boolean).join(' · ') }
        : {})}
      numeric
      keyboardType={field.decimals > 0 ? 'decimal-pad' : 'number-pad'}
      value={typed}
      onChangeText={(raw) => {
        setTyped(raw);
        const trimmed = raw.trim();
        if (trimmed === '') onChange(undefined);
        else if (/^-?\d+(\.\d+)?$/.test(trimmed)) onChange(Number(trimmed));
        else onChange(trimmed);
      }}
    />
  );
}

/** A single choice with this many options or fewer, all its own, shows as chips. */
const CHIP_CHOICES = 8;

function SelectInput({
  field,
  value,
  onChange,
  data,
  error,
}: {
  field: Extract<Field, { type: 'single_select' | 'multi_select' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  data: EntryData;
  error: string | undefined;
}) {
  const { t, locale } = useLanguage();
  const title = choiceTitle(field, locale);
  const choices = field.optionsFrom
    ? catalogueChoices(field.optionsFrom, data.items)
    : (field.options ?? []).map((option) => ({ value: option.key, label: option.label[locale] }));
  if (field.type === 'multi_select') {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Labelled error={error}>
        <CheckGroup
          title={title}
          choices={choices}
          value={chosen}
          onChange={(next) => !data.readOnly && onChange(next.length > 0 ? next : undefined)}
        />
      </Labelled>
    );
  }
  // A few short choices of the form's own read best as chips, as the prototype draws them (D104).
  if (!field.optionsFrom && choices.length <= CHIP_CHOICES) {
    return (
      <Labelled error={error}>
        <Text variant="labelMd">{title}</Text>
        <ChipGroup
          label={title}
          choices={choices}
          value={text(value)}
          onChange={(next) => !data.readOnly && onChange(next)}
        />
      </Labelled>
    );
  }
  return (
    <Labelled error={error}>
      <PickList
        title={title}
        entries={choices}
        value={text(value)}
        onChange={(next) => !data.readOnly && onChange(next)}
        empty={t('entry.no_catalogue')}
      />
    </Labelled>
  );
}

/** Catalogue entries to choose from: products, or active items. */
function catalogueChoices(
  source: 'catalogue_products' | 'catalogue_items',
  items: readonly SyncItem[],
) {
  const active = items.filter((item) => item.active);
  if (source === 'catalogue_items') {
    return active.map((item) => ({ value: item.id, label: item.name, detail: item.code }));
  }
  const products = new Map(active.map((item) => [item.product.id, item.product.name]));
  return [...products].map(([id, name]) => ({ value: id, label: name }));
}

function Rating({
  title,
  value,
  onChange,
  error,
}: {
  title: string;
  value: number;
  onChange: (stars: number) => void;
  error: string | undefined;
}) {
  const { t } = useLanguage();
  const theme = useTheme();
  return (
    <Labelled error={error}>
      <Text variant="labelMd">{title}</Text>
      <View role="radiogroup" aria-label={title} style={styles.row}>
        {[1, 2, 3, 4, 5].map((stars) => (
          <Pressable
            key={stars}
            role="radio"
            aria-checked={value === stars}
            aria-label={t('entry.stars', { count: stars })}
            onPress={() => onChange(stars)}
            style={styles.star}
          >
            <Icon
              icon={Star}
              size="lg"
              color={stars <= value ? theme.colors.accent : theme.colors.borderStrong}
            />
          </Pressable>
        ))}
      </View>
    </Labelled>
  );
}

/** A photo or a scan to take: the button, and once taken, a note and a way to clear it. */
function Capture({
  title,
  kind,
  done,
  onCapture,
  onClear,
  readOnly,
  error,
}: {
  title: string;
  kind: 'photo';
  done: boolean;
  onCapture: () => void;
  onClear: () => void;
  readOnly: boolean;
  error: string | undefined;
}) {
  const { t } = useLanguage();
  // As a 96 px tile, with the dashed one that takes it while there is none (D104).
  return (
    <Labelled error={error}>
      <Text variant="labelMd">{title}</Text>
      <PhotoStrip
        size="lg"
        label={title}
        photos={done ? [{ label: t(`entry.${kind}_taken`) }] : []}
        addLabel={t('entry.photo_take')}
        {...(readOnly || done ? {} : { onAdd: onCapture })}
      />
      {readOnly || !done ? null : (
        <View style={styles.row}>
          <Button
            variant="secondary"
            size="sm"
            icon={Camera}
            label={t('entry.photo_retake')}
            onPress={onCapture}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            label={t('common.remove')}
            onPress={onClear}
          />
        </View>
      )}
    </Labelled>
  );
}

function AccountPick({
  title,
  types,
  accounts,
  value,
  onChange,
}: {
  title: string;
  types: readonly string[];
  accounts: readonly SyncAccount[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useLanguage();
  const offered = accounts
    .filter((account) => types.includes(account.type) && account.status !== 'inactive')
    .map((account) => ({ value: account.id, label: account.name, detail: account.code }));
  return (
    <PickList
      title={title}
      entries={offered}
      value={value}
      onChange={onChange}
      empty={t('entry.no_accounts')}
    />
  );
}

function ContactPick({
  title,
  data,
  value,
  onChange,
  error,
}: {
  title: string;
  data: EntryData;
  value: string;
  onChange: (id: string) => void;
  error: string | undefined;
}) {
  const { t } = useLanguage();
  if (!data.accountId) {
    return (
      <Labelled error={error}>
        <Text variant="labelMd">{title}</Text>
        <Text tone="muted">{t('entry.contact_needs_account')}</Text>
      </Labelled>
    );
  }
  const offered = data.contacts
    .filter((contact) => contact.accountId === data.accountId && contact.active)
    .map((contact) => ({
      value: contact.id,
      label: contact.name,
      ...(contact.role ? { detail: contact.role } : {}),
    }));
  return (
    <Labelled error={error}>
      <PickList
        title={title}
        entries={offered}
        value={value}
        onChange={onChange}
        empty={t('entry.no_contacts')}
      />
    </Labelled>
  );
}

/** A unit's name for a count of it, from the catalogue's units. */
function unitName(
  units: readonly CatalogueUnitView[],
  key: string,
  count: number,
  locale: Locale,
): string {
  const unit = units.find((entry) => entry.key === key);
  return unit ? unit.name[locale][count === 1 ? 'one' : 'other'] : key;
}

/**
 * Item lines (spec 5.6): items from the phone's catalogue, each with a quantity in its base
 * unit unless the field takes none (decision D97), and an amount when the field has a value column.
 */
function ItemLines({
  field,
  lines,
  onChange,
  data,
  issues,
  path,
}: {
  field: Extract<Field, { type: 'product_lines' }>;
  lines: readonly ProductLine[];
  onChange: (lines: ProductLine[]) => void;
  data: EntryData;
  issues: ReadonlyMap<string, string>;
  path: string;
}) {
  const { t, locale } = useLanguage();
  const [adding, setAdding] = useState(false);
  const error = issues.get(path);
  const listed = new Set(lines.map((line) => line.itemId));
  const offered = data.items
    .filter((item) => item.active && !listed.has(item.id))
    .map((item) => ({
      value: item.id,
      label: item.name,
      detail: [item.code, item.packLabel].filter(Boolean).join(' · '),
    }));
  const change = (index: number, patch: Partial<ProductLine>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  return (
    <View style={styles.stack}>
      <Text variant="labelMd">{choiceTitle(field, locale)}</Text>
      {field.help ? (
        <Text variant="bodySm" tone="muted">
          {field.help[locale]}
        </Text>
      ) : null}
      {lines.map((line, index) => {
        const item = data.items.find((entry) => entry.id === line.itemId);
        const at = `${path}[${index}]`;
        const name = item?.name ?? t('entry.item_gone');
        return (
          <Card key={line.itemId} style={styles.stack}>
            <Text variant="bodyLg" weight={600}>
              {name}
            </Text>
            {issues.get(`${at}.itemId`) ? (
              <Text variant="bodySm" tone="danger" role="alert">
                {issues.get(`${at}.itemId`)}
              </Text>
            ) : null}
            {field.quantities === false ? null : (
              <QuantityInput
                label={t('entry.quantity_in', {
                  unit: item ? unitName(data.units, item.baseUnit, 2, locale) : '',
                })}
                value={line.quantity}
                readOnly={data.readOnly}
                onChange={(quantity) => change(index, { quantity })}
                {...(issues.get(`${at}.quantity`) ? { error: issues.get(`${at}.quantity`)! } : {})}
              />
            )}
            {field.valueColumn ? (
              <TextField
                label={field.valueColumn.label[locale]}
                numeric
                keyboardType="decimal-pad"
                editable={!data.readOnly}
                value={line.value ?? ''}
                onChangeText={(raw) => {
                  const amount = raw.replace(/,/g, '').trim();
                  const next: ProductLine = { itemId: line.itemId, quantity: line.quantity };
                  if (amount) next.value = amount;
                  onChange(lines.map((entry, i) => (i === index ? next : entry)));
                }}
                {...(issues.get(`${at}.value`) ? { error: issues.get(`${at}.value`)! } : {})}
              />
            ) : null}
            {data.readOnly ? null : (
              <Button
                variant="ghost"
                icon={Trash2}
                label={t('entry.remove_named', { name })}
                onPress={() => onChange(lines.filter((_, i) => i !== index))}
              />
            )}
          </Card>
        );
      })}
      {error ? (
        <Text variant="bodySm" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
      {data.readOnly || lines.length >= field.maxLines ? null : adding ? (
        <PickList
          title={t('entry.add_item')}
          entries={offered}
          value=""
          onChange={(itemId) => {
            onChange([...lines, { itemId, quantity: 1 }]);
            setAdding(false);
          }}
          empty={t('entry.no_catalogue')}
        />
      ) : (
        <Button
          variant="secondary"
          icon={Plus}
          label={t('entry.add_item')}
          onPress={() => setAdding(true)}
        />
      )}
    </View>
  );
}

/** A quantity with a minus and a plus beside the typed figure, for thumbs in the field. */
function QuantityInput({
  label,
  value,
  onChange,
  readOnly,
  error,
}: {
  label: string;
  value: number;
  onChange: (quantity: number) => void;
  readOnly: boolean;
  error?: string;
}) {
  const { t } = useLanguage();
  const [typed, setTyped] = useState(String(value));
  const set = (next: number) => {
    const kept = Math.max(0, next);
    setTyped(String(kept));
    onChange(kept);
  };
  return (
    <View style={styles.quantity}>
      <View style={styles.grow}>
        <TextField
          label={label}
          numeric
          keyboardType="decimal-pad"
          editable={!readOnly}
          value={typed}
          {...(error ? { error } : {})}
          onChangeText={(raw) => {
            setTyped(raw);
            const parsed = Number(raw.trim());
            if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      </View>
      {readOnly ? null : (
        <View style={styles.row}>
          <Button
            variant="secondary"
            icon={Minus}
            label={t('entry.less')}
            onPress={() => set(Math.ceil(value) - 1)}
          />
          <Button
            variant="secondary"
            icon={Plus}
            label={t('entry.more')}
            onPress={() => set(Math.floor(value) + 1)}
          />
        </View>
      )}
    </View>
  );
}

/** A repeating group: its entries, each with the group's fields, and a way to add one. */
function Group({
  field,
  entries,
  onChange,
  data,
  issues,
  path,
  outer,
}: {
  field: Extract<Field, { type: 'repeating_group' }>;
  entries: readonly Values[];
  onChange: (entries: Values[]) => void;
  data: EntryData;
  issues: ReadonlyMap<string, string>;
  path: string;
  outer: Values;
}) {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const error = issues.get(path);
  return (
    <View style={styles.stack}>
      <Text variant="labelMd">{choiceTitle(field, locale)}</Text>
      {entries.map((entry, index) => (
        <View
          key={index}
          style={[styles.groupEntry, { borderColor: theme.colors.border }]}
          role="group"
          aria-label={t('entry.group_entry', { name: field.label[locale], count: index + 1 })}
        >
          <Text variant="labelSm" tone="muted">
            {t('entry.group_entry', { name: field.label[locale], count: index + 1 })}
          </Text>
          <FieldList
            fields={field.fields}
            values={entry}
            onChange={(values) =>
              onChange(entries.map((current, i) => (i === index ? values : current)))
            }
            issues={issues}
            data={data}
            prefix={`${path}[${index}].`}
            outer={outer}
          />
          {data.readOnly ? null : (
            <Button
              variant="ghost"
              icon={Trash2}
              label={t('entry.remove_entry', { count: index + 1 })}
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
            />
          )}
        </View>
      ))}
      {error ? (
        <Text variant="bodySm" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
      {data.readOnly || entries.length >= field.maxItems ? null : (
        <Button
          variant="secondary"
          icon={Plus}
          label={t('entry.add_entry', { name: field.label[locale] })}
          onPress={() => onChange([...entries, {}])}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.space5 },
  stack: { gap: spacing.space2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  star: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantity: { gap: spacing.space2 },
  grow: { flexGrow: 1 },
  groupEntry: {
    gap: spacing.space3,
    borderLeftWidth: 3,
    paddingLeft: spacing.space3,
    borderRadius: radius.radiusXs,
  },
});
