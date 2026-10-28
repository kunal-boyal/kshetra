# Stage U11: forms, imports, reports, catalogue — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The form builder, an import, the reports and the catalogue read as the prototype's `WebForms`, `WebImports`, `WebReports` and `WebCatalogue`: a builder in three panes, an import as five steps with its counts and each problem's value from the file, reports as a list beside the chosen report with statuses as badges, and the catalogue with a tab per price list.

**Architecture:** Two API tasks (an import's counts and values; a report's status columns), then one task a screen.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U11; the prototype's `WebForms.dc.html`, `WebImports.dc.html`, `WebReports.dc.html` and `WebCatalogue.dc.html`.

## Global constraints

- An import's counts come from its check, never from a trial commit: a commit reaches other planes (people's sign-in through the directory) that a rolled-back transaction would not undo. `ImportTargetSource.check()` returns `{ problems, planned }`, where `planned` is `{ create, update }` for targets that know which rows match a record already (people, accounts, territories, items, statement entries) and null for the rest.
- A problem's `value` is the file's cell for its row and field, as text, filled by the imports service; older jobs have none.
- Skipped rows are the empty rows between the header and the file's last row with anything in it, counted when the file is read.
- A report's status column is `kind: 'status'` with `tones`, the reader's word for each status mapped to a badge tone; files write it as text.
- Nothing is lost: the import's mapping step, preview and Change columns; every report's filters, export and Load more; the catalogue's search, item editor and price list pages; every field setting, nested groups and the phone preview in the builder.
- Out of scope (feature decision 4): the builder's drag and drop (arrows move fields, as now), "Download problems" as a sheet, a price list's draft next version, and the report list's phase badges.

## Review focus

1. **An import of a target without counts** (holidays, targets). The Ready tile shows the rows without "new · updated". Tested.
2. **A problem for the whole file** (row null). No value, no row number. Tested.
3. **A report without a status column.** The table reads as now. Tested.
4. **A caller without `price_list.manage`.** The catalogue shows All products alone. Tested.
5. **A repeating group in the builder.** Its fields are edited inside its own settings, as now. Tested.

---

### Task 1: an import's counts and values (API)

- `ImportProblem.value: string | null` (optional in the schema); `ImportResult.skippedRows: int | null` and `planned: { create, update } | null`; columns `skipped_rows`, `planned_create`, `planned_update` on `cell.import_jobs` (migration).
- `ImportCheck` in `targets.ts`; every target's `check` returns it; `BulkController` takes `.problems`.
- [x] Tests (`test/imports.int.test.ts`): an accounts file with one existing code plans 1 update and the rest new; a problem carries the file's value; empty rows are counted as skipped.

### Task 2: status columns in reports (API)

- `REPORT_COLUMN_KINDS` gains `status`; `ReportColumn.tones?: Record<string, BadgeTone>`; `ColumnSpec.tones` maps message keys to tones and `ReportsService` resolves them to the reader's words.
- The activity log, leave and expense registers, the orders register, visit compliance and the attendance register mark their status column.
- [x] Tests (`test/reports.int.test.ts`): the activity log's status column carries tones in English and Hindi; files still write words.

### Task 3: an import

- A five-step row (what, upload, match columns, check, import) with the current step marked; three `StatTile`s (ready with new and updated, problems in rows, skipped); a notice that nothing is imported until every row passes; the problems table (row, column, value in the file, problem); one action row (change columns, upload again, import N rows).
- [x] Tests (`imports.test.tsx`): the steps for each status; the tiles; a problem's value.

### Task 4: reports

- `SplitDetail`: each report with a one-line description on the left; the chosen report's title with its period, filters and Export CSV and Excel on the right; status cells as badges; the latest export as a one-line notice.
- [x] Tests (`reports.test.tsx`): choosing a report; a status cell's badge; the export notice.

### Task 5: the catalogue

- Header counts (items, price lists), Add and Import; tabs All products and one per price list (`price_list.manage`). All products adds HSN. A list's tab: cards (used by, in force, items priced) and its prices (code, item, pack, MRP, list price, rate, GST, HSN), with a link to edit it.
- [x] Tests (`catalogue.test.tsx`): the tabs; a list's cards and prices; no list tabs without the permission.

### Task 6: the form builder

- Header: Preview on a phone (shows or hides the preview), Publish. The fields as three panes: a grid of field types that adds one, the compact list (handle, label with an asterisk when required, "type · key", the selected one ringed, move and remove), and the selected field's settings, sticky; a condition reads as a sentence above its editor. Nested groups keep their list inside the group's settings.
- [x] Tests (`forms.test.tsx`): adding from the palette selects the new field; selecting shows its settings; the condition sentence.

### Task 7: finish

- [x] e2e mocks and axe; `tools/ui-compare --only forms,imports,reports,catalogue`; 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
