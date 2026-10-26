import { Key, LocalizedText, localizedText, Money } from '@thelamp/shared';
import { z } from 'zod';
import { Condition } from './conditions';

/** Where a photo may come from. Gallery photos are labelled and flagged for reviewers (5.6). */
export const PHOTO_SOURCES = ['camera', 'camera_and_gallery'] as const;

/** The catalogue lists a select field can offer instead of fixed options. */
export const OPTION_SOURCES = ['catalogue_products', 'catalogue_items'] as const;

const valueField = {
  key: Key,
  label: LocalizedText,
  help: localizedText(500).optional(),
  required: z.boolean().default(false).meta({
    description: 'Whether the field must be filled. A field hidden by its condition never is.',
  }),
  visibleWhen: Condition.optional().meta({
    description: 'Show the field only when this holds. Clauses refer to earlier fields.',
  }),
};

const Option = z.strictObject({ key: Key, label: LocalizedText }).meta({ id: 'Option' });

const choices = {
  options: z.array(Option).min(1).max(100).optional(),
  optionsFrom: z.enum(OPTION_SOURCES).optional().meta({
    description:
      'Offer catalogue entries instead of fixed options. Give options or this, not both.',
  }),
};

export const ShortTextField = z
  .strictObject({
    ...valueField,
    type: z.literal('short_text'),
    minLength: z.int().min(0).max(500).optional(),
    maxLength: z.int().min(1).max(500).default(200),
    pattern: z.string().min(1).max(200).optional().meta({
      description: 'A regular expression the whole value must match',
    }),
  })
  .meta({ id: 'ShortTextField' });

export const LongTextField = z
  .strictObject({
    ...valueField,
    type: z.literal('long_text'),
    minLength: z.int().min(0).max(5000).optional(),
    maxLength: z.int().min(1).max(5000).default(2000),
  })
  .meta({ id: 'LongTextField' });

export const NumberField = z
  .strictObject({
    ...valueField,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.int().min(0).max(4).default(0),
    unit: LocalizedText.optional().meta({ description: 'Shown after the value, such as "acres"' }),
  })
  .meta({ id: 'NumberField' });

/** An amount in the tenant's currency. */
export const CurrencyField = z
  .strictObject({
    ...valueField,
    type: z.literal('currency'),
    min: Money.optional(),
    max: Money.optional(),
  })
  .meta({ id: 'CurrencyField' });

export const DateField = z
  .strictObject({
    ...valueField,
    type: z.literal('date'),
    minDaysFromToday: z.int().min(-3660).max(3660).optional().meta({
      description: 'The earliest date allowed, in days from the capture date: 0 is not in the past',
    }),
    maxDaysFromToday: z.int().min(-3660).max(3660).optional().meta({
      description: 'The latest date allowed, in days from the capture date: 0 is not in the future',
    }),
  })
  .meta({ id: 'DateField' });

export const TimeField = z
  .strictObject({ ...valueField, type: z.literal('time') })
  .meta({ id: 'TimeField' });

export const SingleSelectField = z
  .strictObject({ ...valueField, type: z.literal('single_select'), ...choices })
  .meta({ id: 'SingleSelectField' });

export const MultiSelectField = z
  .strictObject({
    ...valueField,
    type: z.literal('multi_select'),
    ...choices,
    minSelected: z.int().min(0).max(100).optional(),
    maxSelected: z.int().min(1).max(100).optional(),
  })
  .meta({ id: 'MultiSelectField' });

export const YesNoField = z
  .strictObject({ ...valueField, type: z.literal('yes_no') })
  .meta({ id: 'YesNoField' });

/** A rating from 1 to 5. */
export const RatingField = z
  .strictObject({ ...valueField, type: z.literal('rating') })
  .meta({ id: 'RatingField' });

/** A photo with its own label, in addition to the form's photos. */
export const PhotoField = z
  .strictObject({
    ...valueField,
    type: z.literal('photo'),
    source: z.enum(PHOTO_SOURCES).default('camera'),
  })
  .meta({ id: 'PhotoField' });

export const BarcodeField = z
  .strictObject({ ...valueField, type: z.literal('barcode') })
  .meta({ id: 'BarcodeField' });

/** Another account in the user's scope, of the listed types. */
export const AccountPickerField = z
  .strictObject({
    ...valueField,
    type: z.literal('account_picker'),
    accountTypes: z.array(Key).min(1).max(20),
  })
  .meta({ id: 'AccountPickerField' });

/** A contact person at the account the form is linked to. */
export const ContactPickerField = z
  .strictObject({ ...valueField, type: z.literal('contact_picker') })
  .meta({ id: 'ContactPickerField' });

/**
 * A repeating table of catalogue items with a quantity, and optionally a value column, such as
 * samples given, stock counted or competitor prices; or, with quantities off, just the items, such
 * as the products a doctor was told about (decision D97).
 */
export const ProductLinesField = z
  .strictObject({
    ...valueField,
    type: z.literal('product_lines'),
    quantities: z.boolean().default(true).meta({
      description:
        'Whether each line takes a quantity. Without, each line counts as one, such as products detailed',
    }),
    valueColumn: z.strictObject({ label: LocalizedText }).optional(),
    maxLines: z.int().min(1).max(200).default(50),
  })
  .meta({ id: 'ProductLinesField' });

/** A heading that groups the fields after it. Layout only. */
export const SectionField = z
  .strictObject({
    key: Key,
    type: z.literal('section'),
    label: LocalizedText,
    visibleWhen: valueField.visibleWhen,
  })
  .meta({ id: 'SectionField' });

/** Text shown to the user, such as an instruction. Layout only. */
export const InfoTextField = z
  .strictObject({
    key: Key,
    type: z.literal('info_text'),
    text: localizedText(1000),
    visibleWhen: valueField.visibleWhen,
  })
  .meta({ id: 'InfoTextField' });

const groupItems = [
  ShortTextField,
  LongTextField,
  NumberField,
  CurrencyField,
  DateField,
  TimeField,
  SingleSelectField,
  MultiSelectField,
  YesNoField,
  RatingField,
  PhotoField,
  BarcodeField,
  AccountPickerField,
  ContactPickerField,
  ProductLinesField,
  InfoTextField,
] as const;

/** A field inside a repeating group: any type but a section or another group. */
export const GroupItemField = z.discriminatedUnion('type', [...groupItems]);

/** A set of fields the user fills once per item, such as one row per person met. */
export const RepeatingGroupField = z
  .strictObject({
    ...valueField,
    required: valueField.required.meta({
      description: 'Whether at least one item must be added',
    }),
    type: z.literal('repeating_group'),
    fields: z.array(GroupItemField).min(1).max(20),
    maxItems: z.int().min(1).max(50).default(20),
  })
  .meta({ id: 'RepeatingGroupField' });

/** Any field of a form: the field types of spec 5.6, version 1. */
export const FormField = z
  .discriminatedUnion('type', [...groupItems, SectionField, RepeatingGroupField])
  .meta({ id: 'FormField' });

/**
 * A custom field on an account type, a user or a catalogue item: the value types that suit a
 * record's profile.
 */
export const CustomField = z
  .discriminatedUnion('type', [
    ShortTextField,
    LongTextField,
    NumberField,
    CurrencyField,
    DateField,
    SingleSelectField,
    MultiSelectField,
    YesNoField,
  ])
  .meta({ id: 'CustomField' });

export type FormField = z.output<typeof FormField>;
export type GroupItemField = z.output<typeof GroupItemField>;
export type CustomField = z.output<typeof CustomField>;
export type AnyField = FormField | GroupItemField | CustomField;
export type FieldType = FormField['type'];
