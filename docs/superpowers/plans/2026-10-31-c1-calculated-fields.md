# Phase 4 step C1: calculated form fields — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a form field whose value is a formula over the form's number, currency and quantity fields, using `+ − × ÷`, rounding, `min`, `max` and `if`. It is worked out live on the phone and again on the server. The evaluator is a small parser, never `eval`, and the form builder shows each formula as a sentence (D109).

**Architecture:**
- **A new field type, `calculated`:**
  - its settings are `{ key, label, help?, visibleWhen?, formula, result: 'number' | 'currency', decimals (0 to 4, number only), unit? }`;
  - nobody types into it, so it is never `required`;
  - it is a form field only: not a custom field, and not inside a repeating group in this version.
- **The formula engine:** `packages/forms/src/formula.ts`, pure, shared by the server, the portal and the phone. It has three parts:
  - **a tokenizer and a recursive-descent parser** that builds a small tree. It accepts numbers, field keys, `+ - * / ( )`, unary minus, and the functions `round(x, places)`, `min(a, b, …)`, `max(a, b, …)`, `if(a <op> b, then, else)` with `< <= > >= = !=`, and `default(field, value)`. A formula is at most 500 characters and 200 tree nodes;
  - **an exact evaluator:** fractions of `bigint`s, so currency is exact to the paisa and the phone and the server agree to the digit. The result is rounded half up to the field's places, 2 for currency, as money is elsewhere. Division by zero gives no value;
  - **a describer:** `describeFormula(tree, labels, locale)` gives the sentence the builder shows, for example "Acres × Rate per acre, rounded to 2 places", in English and Hindi.
- **What a formula may use:**
  - number and currency fields, earlier calculated fields, and a product lines field, whose value is its total quantity;
  - only fields before it in the form, so there is no cycle and the order is the order of evaluation.
- **Server:** `checkFormValues` works out each calculated field from the checked values, in form order, and stores it like a number or an amount. A value sent for a calculated field is replaced. A hidden calculated field keeps no value, like any hidden field.
- **Where calculated values count:** conditions and metrics treat a calculated field as its result type (number or currency), so `visibleWhen`, metric filters and `submission_field_sum` can use it.

**Spec:** 5.6 (field types), M7; D45, D46, D109.

## Global constraints

- **Rules** (`packages/forms`):
  - `parseFormula(text)` gives `{ tree } | { issue }`;
  - `formulaIssues(field, earlier)` is the second-layer check: known fields of an allowed type, earlier in the form, at most 20 references;
  - `evaluate(tree, values)` gives a decimal string or null;
  - `describeFormula()` gives the builder's sentence.
- **Empty fields:** the decision below.
- **Field type stability (D45):** once a form version used a key as `calculated`, it stays `calculated`, as for every type. Changing the formula is a new version, like any field change.
- **Templates schema:** the `calculated` field joins `FormField`. Regenerate `schema.json` and the OpenAPI document. No template uses it yet.
- **Words:** English and Hindi, for the builder, its error messages and the sentence.

## Review focus

1. **Money exactness:** 3 × 33.33, and 100 ÷ 3 rounded to 2 places, give the same digits on the phone and the server. Tested with fixtures in `formula.test.ts`.
2. **A formula naming a later field, itself, a text field or an unknown key:** refused on save, with its path. Tested.
3. **Division by zero, and `if` whose false branch divides by zero:** no value, and no error when the branch isn't taken. Tested.
4. **A hidden calculated field:** keeps no value, and a field that uses it sees it as empty. Tested.
5. **A long or deeply nested formula:** refused by length and node limits, not by a stack overflow. Tested.

---

### Task 1: the engine

- `formula.ts`: tokenizer, parser, evaluator and describer, with `formula.test.ts`.
- [x] Tests (unit): each operator and function, precedence, half-up rounding, exact money, division by zero, the limits, and each refusal with its position.

### Task 2: the field, the checks and the server

- `CalculatedField` in `fields.ts` and `FormField`; `formulaIssues` in `form.ts`; working out values in `checkFormValues`; conditions, `operatorsFor` and the metrics check by result type; schema and `pnpm openapi`.
- [x] Tests:
  - unit: a form's checks, and values worked out;
  - integration: a submission whose calculated value the server works out and stores, ignoring the one sent; a metric summing a calculated currency field.

### Task 3: the portal

- **The builder:** a `calculated` field type with a formula box, its sentence underneath as it is typed, problems by position, and result type, places and unit.
- **The preview** works the value out live, and submissions show it like any number or amount.
- [x] Tests (Vitest and Playwright with axe).

### Task 4: the phone (pull request 2)

- `FieldList` shows a calculated field read-only, worked out live as the person types, with its unit; `checkEntry` works it out as the server will.
- [x] Tests (Jest).

### Task 5: finish

- [ ] Decision D118, spec 5.6, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before each merge.
