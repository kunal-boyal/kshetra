import { SYSTEM_ROLES, TENANT_PERMISSIONS } from '@thelamp/shared';
import { describe, expect, it } from 'vitest';
import type { TemplateInput } from './schema/template';
import { validateTemplate } from './validate';

const text = (en: string) => ({ en, hi: en });
const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });

/** A small, valid template in neutral words. Each test breaks one thing in a copy. */
function sample(): TemplateInput {
  return {
    key: 'sample',
    version: 1,
    name: text('Sample'),
    description: text('A small template for tests'),
    roles: SYSTEM_ROLES.map((key) => ({
      key,
      name: text(key),
      scope: 'tenant',
      permissions: key === 'tenant_admin' ? [...TENANT_PERMISSIONS] : ['report.view'],
    })),
    designations: [
      { key: 'lead', name: noun('Lead'), level: 1, defaultRole: 'manager', canHaveReports: true },
      {
        key: 'rep',
        name: noun('Rep'),
        level: 2,
        defaultRole: 'field_user',
        canHaveReports: false,
        ranked: true,
      },
    ],
    geographyLevels: [
      { key: 'region', name: noun('Region') },
      { key: 'area', name: noun('Area') },
    ],
    userFields: [{ key: 'base', type: 'short_text', label: text('Base') }],
    accountTypes: [
      {
        key: 'customer',
        name: noun('Customer'),
        icon: 'building-2',
        code: { mode: 'manual' },
        fields: [{ key: 'size', type: 'number', label: text('Size') }],
        location: {},
        slots: [
          { key: 'rep', name: text('Rep'), designations: ['rep'], priority: 1 },
          { key: 'lead', name: text('Lead'), designations: ['lead'], priority: 2 },
        ],
        segmentRules: [
          {
            segment: 'large',
            name: text('Large'),
            when: { clauses: [{ field: 'size', op: 'gt', value: 100 }] },
          },
        ],
        visitFrequencyNorms: [{ segment: 'large', visitsPerMonth: 4 }],
      },
    ],
    forms: [
      {
        key: 'visit_report',
        name: noun('Visit report'),
        icon: 'map-pin',
        accountLink: { mode: 'required', accountTypes: ['customer'] },
        visitSession: true,
        fields: [{ key: 'outcome', type: 'long_text', label: text('Outcome'), required: true }],
      },
    ],
    metrics: [
      {
        key: 'visits',
        name: noun('Visit'),
        unit: 'count',
        source: { type: 'submission_count', forms: ['visit_report'] },
      },
    ],
    score: { metrics: [{ metric: 'visits', weight: 100 }] },
    workflows: {
      fallbackRole: 'tenant_admin',
      definitions: [
        { requestType: 'leave', steps: [{ approver: { type: 'reporting_manager' } }] },
        { requestType: 'order', steps: [{ approver: { type: 'account_slot', slot: 'lead' } }] },
      ],
    },
    people: {
      calendars: [{ key: 'standard', name: text('Standard'), weeklyOffs: [7] }],
      defaultCalendar: 'standard',
      attendance: { rule: 'punch_is_present' },
      expensePolicies: [
        {
          key: 'travel',
          name: text('Travel'),
          category: 'travel',
          calculation: 'per_km',
          rate: { flat: '3.50' },
          odometerPhotosRequired: true,
        },
      ],
    },
    catalogue: {
      units: [
        { key: 'piece', name: noun('Piece'), base: true },
        { key: 'box', name: noun('Box') },
      ],
      itemFields: [{ key: 'grade', type: 'short_text', label: text('Grade') }],
      rejectionReasons: [{ key: 'no_stock', name: text('No stock') }],
    },
    imports: {
      users: { aliases: { code: ['empid'], 'custom.base': ['base'] } },
      accounts: { customer: { aliases: { 'slot.rep': ['repname'] }, emptyValues: ['-'] } },
      items: { aliases: { 'custom.grade': ['grade'] }, fractions: ['tax_rate'] },
    },
  };
}

/** The issues of a copy of the sample changed by `change`, as `path: issue` lines. */
function issuesAfter(change: (template: TemplateInput) => void): string[] {
  const template = structuredClone(sample());
  change(template);
  const result = validateTemplate(template);
  return result.ok ? [] : result.issues.map(({ path, issue }) => `${path}: ${issue}`);
}

describe('validateTemplate', () => {
  it('accepts a consistent template and fills in its defaults', () => {
    const result = validateTemplate(sample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.terminology).toEqual({});
    expect(result.template.accountTypes[0]?.location).toEqual({
      required: false,
      geofencePolicy: 'advisory',
      fieldUsersMayPropose: true,
    });
    expect(result.template.roles[0]?.mobileOnly).toBe(false);
  });

  it('reports shape problems with their paths', () => {
    expect(
      issuesAfter((template) => {
        template.version = 0;
        Object.assign(template, { terminology: { 'term.visit': text('Call') } });
      }),
    ).toEqual([
      'version: Too small: expected number to be >=1',
      'terminology: Unrecognized key: "term.visit"',
    ]);
  });

  it('takes terminology nouns with both forms, and labels as plain text', () => {
    expect(
      issuesAfter((template) => {
        template.terminology = {
          'term.account': noun('Client'),
          'term.punch_in': text('Check in'),
          'term.plan_item': text('Stop') as never,
        };
      }),
    ).toEqual([
      'terminology.term.plan_item.en: Invalid input: expected object, received string',
      'terminology.term.plan_item.hi: Invalid input: expected object, received string',
    ]);
  });

  it('needs every system role, and a tenant admin who holds everything', () => {
    expect(
      issuesAfter((template) => {
        template.roles = template.roles.filter((role) => role.key !== 'viewer');
        template.roles.push({
          key: 'auditor',
          name: text('Auditor'),
          scope: 'tenant',
          permissions: ['audit.view'],
        });
        const admin = template.roles[0]!;
        admin.permissions = admin.permissions.filter(
          (permission) => permission !== 'billing.manage',
        );
        admin.scope = 'team';
      }),
    ).toEqual([
      'roles: Add the system role `viewer` (spec 4.2)',
      'roles[0].permissions: The tenant admin holds every permission; add `billing.manage`',
      'roles[0].scope: The tenant admin reaches the whole tenant',
    ]);
  });

  it('keeps vendor permissions out of tenant roles', () => {
    const issues = issuesAfter((template) => {
      template.roles[1]!.permissions = ['platform.tenant.manage' as never];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^roles\[1\]\.permissions\[0\]: Invalid option/);
  });

  it('checks designations', () => {
    expect(
      issuesAfter((template) => {
        template.designations[0]!.defaultRole = 'chief';
        template.designations[1]!.ranked = false;
      }),
    ).toEqual([
      'designations[0].defaultRole: There is no role `chief`',
      'designations: Rank at least one designation, or no one appears in rankings (D8)',
    ]);
  });

  it('checks account types: parents, slots, segments and norms', () => {
    expect(
      issuesAfter((template) => {
        const type = template.accountTypes[0]!;
        type.parentTypes = ['vendor'];
        type.slots[1]!.priority = 1;
        type.slots[1]!.designations = ['chief'];
        type.segmentRules![0]!.when.clauses[0]!.field = 'turnover';
        type.visitFrequencyNorms = [{ segment: 'small', visitsPerMonth: 1 }];
      }),
    ).toEqual([
      'accountTypes[0].parentTypes[0]: There is no account type `vendor`',
      'accountTypes[0].slots[1].priority: Another slot already has priority 1',
      'accountTypes[0].slots[1].designations[0]: There is no designation `chief`',
      'accountTypes[0].segmentRules[0].when.clauses[0].field: Account type `customer` has no field `turnover`',
      'accountTypes[0].visitFrequencyNorms[0].segment: No segment rule tags `small`',
    ]);
  });

  it('checks forms, metrics and the score against the rest of the template', () => {
    expect(
      issuesAfter((template) => {
        template.forms[0]!.accountLink = { mode: 'required', accountTypes: ['vendor'] };
        template.forms.push({ ...template.forms[0]!, accountLink: undefined, visitSession: false });
        template.metrics[0]!.source = { type: 'submission_count', forms: ['survey'] };
        template.score.metrics.push({ metric: 'calls', weight: 10 });
      }),
    ).toEqual([
      'forms[1].key: Form `visit_report` appears more than once',
      'forms[0].accountLink.accountTypes[0]: There is no account type `vendor`',
      'metrics[0].source.forms[0]: There is no form `survey`',
      'score.metrics[1].metric: There is no metric `calls`',
    ]);
  });

  it('checks approval chains (BR-31)', () => {
    expect(
      issuesAfter((template) => {
        template.workflows.fallbackRole = 'chief';
        template.workflows.definitions.push(
          {
            requestType: 'leave',
            steps: [{ approver: { type: 'account_slot', slot: 'rep' }, lineDecisions: true }],
          },
          {
            requestType: 'expense',
            steps: [
              {
                approver: { type: 'nearest_designation', designation: 'chief' },
                reminderAfterHours: 48,
                escalation: { afterHours: 24, to: 'nobody' },
              },
            ],
          },
          {
            requestType: 'new_account',
            steps: [{ approver: { type: 'account_slot', slot: 'owner' } }],
          },
        );
      }),
    ).toEqual([
      'workflows.fallbackRole: There is no role `chief`',
      'workflows.definitions[2].requestType: `leave` already has a workflow',
      'workflows.definitions[2].steps[0].approver: A `leave` request has no account to take a slot from',
      'workflows.definitions[2].steps[0].lineDecisions: Only order approvers decide line by line',
      'workflows.definitions[3].steps[0].approver.designation: There is no designation `chief`',
      'workflows.definitions[3].steps[0].escalation.to: There is no role `nobody`',
      'workflows.definitions[3].steps[0].reminderAfterHours: Remind before escalating',
      'workflows.definitions[4].steps[0].approver.slot: No account type has slot `owner`',
    ]);
  });

  it('checks people policies', () => {
    expect(
      issuesAfter((template) => {
        const people = template.people;
        people.defaultCalendar = 'national';
        people.attendance = { rule: 'hours', fullDayHours: 4, halfDayHours: 4 };
        people.expensePolicies = [
          { key: 'a', name: text('A'), category: 'travel', calculation: 'per_km' },
          {
            key: 'b',
            name: text('B'),
            category: 'other',
            calculation: 'actual',
            rate: { flat: '10' },
          },
          {
            key: 'c',
            name: text('C'),
            category: 'daily_allowance',
            calculation: 'per_day',
            rate: { byDesignation: { rep: '0', chief: '500' } },
            odometerPhotosRequired: true,
          },
        ];
      }),
    ).toEqual([
      'people.defaultCalendar: There is no calendar `national`',
      'people.attendance.halfDayHours: A half day needs fewer hours than a full day',
      'people.expensePolicies[0].rate: A per_km policy needs a rate',
      'people.expensePolicies[1].rate: A claim of the bill amount takes no rate',
      'people.expensePolicies[2].rate.byDesignation.rep: Use an amount above zero',
      'people.expensePolicies[2].rate.byDesignation.chief: There is no designation `chief`',
      'people.expensePolicies[2].odometerPhotosRequired: Odometer photos apply to per-km claims only',
    ]);
  });

  it('needs exactly one base unit in the catalogue', () => {
    expect(
      issuesAfter((template) => {
        template.catalogue!.units[1]!.base = true;
      }),
    ).toEqual(['catalogue.units: Mark exactly one unit as the base; 2 are']);
  });

  it('checks import aliases name real columns, once each', () => {
    expect(
      issuesAfter((template) => {
        template.imports = {
          users: {
            aliases: { code: ['empid'], employee: ['emp'], 'custom.hq': ['hq'], name: ['empid'] },
          },
          accounts: {
            customer: { aliases: { 'slot.owner': ['owner'] }, fractions: ['code'] },
            vendor: { aliases: { code: ['vendorcode'] } },
          },
          items: { aliases: { price: ['Price'] } },
        };
      }),
    ).toEqual([
      'imports.items.aliases.price[0]: Write the header as the import compares it: lowercase letters and digits only',
    ]);
    expect(
      issuesAfter((template) => {
        template.imports = {
          users: {
            aliases: { code: ['empid'], employee: ['emp'], 'custom.hq': ['hq'], name: ['empid'] },
          },
          accounts: {
            customer: { aliases: { 'slot.owner': ['owner'] }, fractions: ['code'] },
            vendor: { aliases: { code: ['vendorcode'] } },
          },
        };
      }),
    ).toEqual([
      'imports.users.aliases.employee: There is no column `employee`',
      'imports.users.aliases.custom.hq: There is no column `custom.hq`',
      'imports.users.aliases.name[0]: `empid` already stands for `code`',
      'imports.accounts.customer.aliases.slot.owner: There is no column `slot.owner`',
      'imports.accounts.customer.fractions[0]: `code` is not a percentage column',
      'imports.accounts.vendor: There is no account type `vendor`',
    ]);
  });
});
