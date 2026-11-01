# Phase 4 step C3: the building materials and paints template — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the building materials and paints template of spec Appendix A.5 in `packages/templates/building/template.json`. It is validated and provisionable, with a demo tenant whose words come from its own flavour in `flavourOf()`, as pharma and FMCG have (D97).

**Kunal's answers (2026-11-01), decision D120:**

| Question | Answer |
|---|---|
| Team | Business Head (1), RSM (2), ASM (3), TSM (4, ranked); the field user is called "TSM" |
| Geography | Zone → Region → Area → Territory |
| Sites converted | Sites whose approved site visit that month answered "Ordered from our dealer?" with yes |
| Catalogue | Paints and allied products: paints, primer, putty and waterproofing, in litres and kilograms, sold by the tin, bucket and bag |
| Orders | Kunal chose "over the dealer's credit goes to the ASM". As every order waits for someone to accept it, the ASM above whoever placed it accepts every order line by line, and an order over the account's credit needs the RSM as well (D120) |
| New accounts | Field users propose contractors, painters and sites in the app, and the ASM approves; the office adds dealers |

**Spec:** Appendix A.5, 5.5 to 5.11, 5.14; D97, D109. Template key `building`, version 1.

## What the template holds

- **Terminology:** field user "TSM"; account "Customer" stays the product's word.
- **Account types:**
  - **Dealer:** slots `asm` and `tsm`. Fields `gstin`, `credit_limit` (currency) and `tinting_machine` (yes/no). Geofence 100 m. Added by the office.
  - **Contractor or painter:** slot `tsm`; parent Dealer, its usual supplier. Fields:
    - `trade`* (Painter, Contractor, Mason, Applicator);
    - `crew_size` (number);
    - `loyalty_id` (short text);
    - `phone`.

    Proposed by field users; the ASM approves.
  - **Site:** slot `tsm`. Fields:
    - `stage`* (Foundation, Structure, Plastering, Painting, Completed);
    - `estimated_requirement` (number, with the unit `L`);
    - `builder_name`.

    Proposed by field users; the ASM approves. Geofence 150 m.
- **Forms:**
  - **Dealer visit:** Dealer account, visit session. `sales`* (currency), `collection` (currency), `stock_ok` (yes/no), `outcome`*, a photo optional. An order may be taken in the visit.
  - **Site visit:** Site account. `stage`*, `requirement` (number, L), `competitor_brand` (select with Other), `ordered_from_dealer`* (yes/no), `dealer` (account picker, Dealer, shown when yes); 1 to 3 photos required.
  - **Influencer meet:** no account, off-shift allowed. `venue`*, `attendees`* (number), `enrolments`* (number, at most the attendees), and a group photo required.
  - **Product demonstration:** a Contractor or painter, or a Site, as the account (optional). `products`* (product lines without quantities), `attendees` (number), `feedback`, and a photo required.
- **Metrics:**

  | Metric | Source |
  |---|---|
  | `dealer_sales` | `submission_field_sum` of `sales` on Dealer visits |
  | `collection` | `submission_field_sum` of `collection` on Dealer visits |
  | `site_visits` | `submission_count` of Site visits |
  | `sites_converted` | `distinct_accounts_visited` on Site visits where `ordered_from_dealer` is yes |
  | `enrolments` | `submission_field_sum` of `enrolments` on Influencer meets |
  | `active_days` | `active_days` |
  | `order_value` | `order_value` (counts while orders are on) |

- **Score:** dealer sales 40, collection 20, site visits 20, enrolments 20.
- **Engine change (additive):** `distinct_accounts_visited` takes an optional `where` condition, as `submission_count` already does, so a site counts once however often it answered yes. Regenerate `schema.json`.
- **Workflows:**
  - a new account goes to the ASM;
  - leave, regularisation and expenses go to the ASM, then the RSM;
  - orders are accepted by line by the nearest ASM, and need the RSM too when over credit;
  - the fallback is the Business Head.
- **People:**
  - the standard calendar, attendance rule and leave types (as the others);
  - expenses of fuel at ₹3.50 a km and a daily allowance of ₹250 to ₹800 by designation (values to confirm at onboarding, README).
- **Catalogue:**
  - units: the pack (base) and the carton, with the measure types `L` and `kg`, so packs of 1, 4, 10 and 20 L and 20 and 40 kg are items;
  - item field `shade_family`;
  - the same rejection reasons as FMCG.
- **Imports:** other column names, such as "Dealer code" and "Painter ID".
- **Words:** English and Hindi throughout, in the trade's words: dealer, painter, contractor, site, shade, putty.

## Demo

- `BUILDING` in `apps/api/src/demo/names.ts`, used when the template is `building`, and the demo fills account pickers (the site visit's dealer) from the accounts the person calls on. The flavour holds:
  - names for dealers ("Sharma Paints and Hardware, Nashik"), contractors and painters, and sites ("Shree Ganesh Residency, Phase 2");
  - products with packs and MRPs (an emulsion in 1, 4, 10 and 20 L; primer; wall putty in 20 and 40 kg; waterproofing);
  - outcomes, observations and rejections;
  - gatherings (painters' meets at halls);
  - topics, and scenes (a site photo is a `field` scene).
- `pnpm provision --template building --demo` makes a demo tenant that the generator fills without a single refusal.

## Review focus

1. **The template is valid:** every reference resolves, the JSON schema accepts it, and it provisions through the console and `pnpm provision`. Tested by `templates.test.ts` and an integration test that provisions it.
2. **Sites converted:** a site visited twice with yes counts once, and a no counts nothing. Tested in `calculate.test.ts` and by the demo.
3. **The dealer picker on the site visit:** it shows only when the answer is yes, and offers only dealers. Tested by the template's form checks.
4. **The demo:** it runs end to end with no refused record, in its own words, with no agri word in it. Tested by the demo content's integration test.
5. **Hindi:** every string has Hindi. The README lists the template's values to confirm at onboarding, and a native speaker reviews the Hindi before the pilot, as for the others.

---

### Task 1: the engine's `where` on distinct accounts

- [x] Tests (unit): `calculate.test.ts` and `check.test.ts`.

### Task 2: the template

- `building/template.json`, the registry, the README row and its values to confirm, `schema.json`.
- [x] Tests: `pnpm --filter @thelamp/templates test`; the provisioning test that loads every template, and the demo test, which provisions it and fills its forms.

### Task 3: the demo

- The `BUILDING` flavour, and the demo for `building`.
- [x] Tests (integration): the demo content test for the template.

### Task 4: finish

- [ ] Decision D120, spec Appendix A.5 with these choices, `CLAUDE.md`, the progress row and tracker; `pnpm verify` before the merge.
