import { CustomField, FormDefinition } from '@kshetra/forms';
import { MetricDefinition, ScoreDefinition } from '@kshetra/metrics';
import {
  Key,
  LocalizedNoun,
  LocalizedText,
  localizedText,
  SYSTEM_ROLES,
  TERMINOLOGY_KEYS,
  type TerminologyKey,
} from '@kshetra/shared';
import { z } from 'zod';
import { AccountType } from './account-types';
import { Catalogue } from './catalogue';
import { Imports } from './imports';
import { Designation, GeographyLevel, Role } from './organisation';
import { People } from './people';
import { Workflows } from './workflows';

const TermLabel = localizedText(40);

type TerminologyShape = {
  [K in TerminologyKey]: z.ZodOptional<
    (typeof TERMINOLOGY_KEYS)[K] extends 'noun' ? typeof LocalizedNoun : typeof TermLabel
  >;
};

/** Overrides of the product's words (spec 5.2). Leave a key out to keep the default. */
export const Terminology = z
  .strictObject(
    Object.fromEntries(
      Object.entries(TERMINOLOGY_KEYS).map(([key, kind]) => [
        key,
        (kind === 'noun' ? LocalizedNoun : TermLabel).optional(),
      ]),
    ) as TerminologyShape,
  )
  .meta({ id: 'Terminology' });

/**
 * An industry template: a tenant's starting configuration, applied once when the tenant is
 * created (spec 5.14). Later versions can add forms or metrics to existing tenants, never
 * overwrite what a tenant changed.
 */
export const TemplateSchema = z
  .strictObject({
    $schema: z.string().optional(),
    key: Key.meta({ description: "The template's folder name" }),
    version: z.int().min(1).meta({
      description:
        'Raise it whenever the template changes; each tenant records the version it started from',
    }),
    name: LocalizedText,
    description: localizedText(300),
    terminology: Terminology.default({}),
    roles: z.array(Role).min(SYSTEM_ROLES.length).max(30),
    designations: z.array(Designation).min(1).max(20),
    geographyLevels: z.array(GeographyLevel).min(2).max(6),
    userFields: z.array(CustomField).max(30).default([]),
    accountTypes: z.array(AccountType).min(1).max(20),
    forms: z.array(FormDefinition).min(1).max(100),
    metrics: z.array(MetricDefinition).min(1).max(100),
    score: ScoreDefinition,
    workflows: Workflows,
    people: People,
    catalogue: Catalogue.optional(),
    imports: Imports.default({}),
  })
  .meta({
    title: 'Industry template',
    description: "A tenant's starting configuration (spec 5.14 and Appendix A)",
  });

export type Template = z.output<typeof TemplateSchema>;
export type TemplateInput = z.input<typeof TemplateSchema>;
