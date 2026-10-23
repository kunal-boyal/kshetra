# Industry templates

A template is a tenant's starting configuration (spec 5.14 and Appendix A). The platform applies one when it creates a tenant, and from then on the tenant's configuration is its own. A later template version can offer additions, such as new forms or metrics, but never overwrites what a tenant changed.

| Template | File | Summary |
|---|---|---|
| Generic | [`generic/template.json`](generic/template.json) | Customers, visit and meeting forms, and metrics for visits, coverage and order value (spec A.1) |
| Agri inputs | [`agri/template.json`](agri/template.json) | Distributors, retailers and farmers; farmer meetings, demos and distributor visits with sales, collection and liquidation; orders by the case (spec A.2) |

## What a template holds

| Section | What it sets | Spec |
|---|---|---|
| `terminology` | Overrides of the product's words, such as "Beat plan" for journey plan | 5.2 |
| `roles` | The six system roles, with their permissions and data scope | 4.2, Appendix E |
| `designations` | Job titles with levels, default roles, and who is ranked | 5.3, D8 |
| `geographyLevels` | The territory levels, highest first (two to six) | 5.4 |
| `userFields` | Custom fields on users | 5.3 |
| `accountTypes` | Fields, slots, location and geofence, segment rules, visit norms | 5.5 |
| `forms` | What field users record | 5.6 |
| `metrics`, `score` | What is measured, and how the score weighs it | 5.7, 5.8, BR-06 |
| `workflows` | Approval chains per request type | 5.9, BR-31 |
| `people` | Holiday calendars, the attendance rule, leave types, expense policies | 5.10 |
| `catalogue` | Units, measures, rounding, item fields, rejection reasons (optional) | 5.11 |
| `imports` | Other names for import columns, so customers' own files map at once | M19, Appendix B |
| `settings` | Working rules, such as the geofence radius or the GPS interval (optional). Never the tenant's names, address, GSTIN, logo, brand colour or Maps key | 5.1, D66 |

Everything refers to everything else by key, never by ID, so a template holds no tenant data and names no users. That's why a workflow step can't use the `specific_user` resolver here; tenants set it themselves.

The zod schemas live where spec 9.4 puts them: form fields, conditions and forms in `packages/forms`; metrics and the score in `packages/metrics`; the rest in `src/schema` here. The account type, workflow and people schemas may move to their modules' packages when those modules arrive; the JSON format stays the same.

## Exported configuration

A tenant's configuration exports in this same format (`GET /v1/configuration/export`, decision D66), so a file prepared in staging can be imported into another tenant, which adds and updates but never removes, or start a new one with `pnpm provision --file <path>`.

## Editing a template

- Write every piece of text in English and Hindi. Names of things that can be counted (account types, forms, metrics, designations, units) give a singular (`one`) and a plural (`other`) in each language.
- Keys are lowercase snake case (`next_visit_date`) and never change once tenants use them. Raise `version` with every change.
- Write money as a decimal string, such as `"3.50"`, never as a number (spec 10.1).
- Fields stay optional unless `required` says so. A field hidden by its `visibleWhen` condition is never required, and a condition can only refer to fields before it.
- Metrics on orders count only while the tenant has the orders module on, so a template can include them for tenants who add orders later.
- An account type with `"active": false` is provisioned switched off, for the admin to switch on (the agri farmer type).

Check your work with:

```bash
pnpm --filter @thelamp/templates test
```

That validates every template's shape, checks that every reference resolves and that settings agree with each other and the business rules, and checks each file against `schema.json`. Each problem is reported at its path, for example `forms[3].fields[4].visibleWhen.clauses[0].value: purpose has no option salez`.

Each file starts with `"$schema": "../schema.json"`, so editors such as VS Code offer completion and flag shape errors as you type.

## Changing the schema

`schema.json` is generated from the zod schemas. After changing them, regenerate it:

```bash
pnpm --filter @thelamp/templates schema
```

CI fails while the committed file is out of date. Keep changes additive: new optional properties or new values, so existing templates and tenant configurations stay valid.

## Values to confirm with each customer

The spec doesn't fix these, so the templates hold reasonable starting points. Review them with each customer at onboarding (spec 15, onboarding checklist step 5):

- The default roles' permissions (decision D26)
- Leave types: casual leave (12 days), sick leave (12 days, attachment after 2 days) and unpaid leave
- The standard holiday calendar, with Sunday off; dated holidays are imported each year (spec B.7)
- Agri inputs: fuel at ₹3.50 per km; a daily allowance of ₹250 to ₹750 by designation; the crop list
- The Hindi text, which needs a review by a native speaker before the pilot

## Not in templates yet

- **Notification template choices and report presets** (spec 5.14). They arrive as optional sections with notifications (M16) and reports (M18) in phase 1.
- **Workflow step conditions**, such as "only when `amount > 5000`" (spec 5.9). They arrive with the workflow engine in phase 2.
- **What the pharma and FMCG templates need** (phase 3): a signature required only when samples are given, an order taken within a visit, and a field shown only when no order was placed.
