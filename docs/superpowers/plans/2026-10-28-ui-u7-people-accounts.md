# Stage U7: People and accounts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax.

**Goal:** People and Accounts look like the prototype's `WebPeople` and `WebAccounts`: status chips with counts and a seats line over the people, account-type tabs with counts, a banner for proposals waiting, and the outstanding balance in the accounts table.

**Architecture:** One API task (counts, seats, a territory filter for people, counts and the outstanding balance for accounts), then the two lists and the person page's header.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U7; the prototype's `WebPeople.dc.html` and `WebAccounts.dc.html`.

## Global constraints

- Module boundaries: people read territories through `TerritoriesService`; accounts read balances through a seam the finance module provides (`AccountBalances`, as `OrderCredit` and `AttendanceLeave` do), since finance already depends on accounts. With finance switched off, the balance is null.
- Numbers on screen are masked as the prototype shows them (`maskPhone()`), the full number stays on the person's page for those who may see it.
- "Invited" and "Phone reset" person states are out of scope (feature decision 4); "Market" is a territory, shown as the territory.
- Every word in en and hi; account words through `{term.account}`.

## Review focus

1. **No seat limit.** The seats line is left out, never "of null". Tested.
2. **A tenant with one account type.** No tabs, just the table. Tested.
3. **No proposals waiting.** No banner. Tested.
4. **Finance off, or no snapshot.** Outstanding shows "—". Tested.
5. **390 px.** Chips wrap; tables scroll in their box. Checked in the browser.

---

### Task 1: the figures (API)

- `UserListQuery.territoryId` (this territory and everything under it, by today's attachments, through `TerritoriesService.usersUnder()`); `UserListResult.summary: { counts: { active, inactive }, seats: { used, limit } | null } | null` with the first page only, under the filters but status.
- `AccountListResult.summary: { types: Record<typeKey, int>, pending: int } | null` with the first page only: active and pending accounts by type under the filters but type and status, and the pending ones of the type asked for.
- `AccountResult.outstanding: string | null` (the latest balance), through `AccountBalances.latest(tx, tenantId, ids)`, provided by `FinanceService`.
- [x] Tests (`test/users.int.test.ts`, `test/accounts.int.test.ts`, `test/finance.int.test.ts`): counts and seats; a territory narrows people; type counts and pending; the outstanding balance after a snapshot.

### Task 2: the pages

- People: title, meta "53 people · 46 active · 41 seats used of 50", actions Import and Add a person; toolbar status chips (Active, Inactive) with counts, Designation and Territory pickers as ghost menus; the table with Avatar and bold name, designation, territory, reports to, masked mobile in `ks-num`, phone, status.
- Person page: Avatar `lg` in the header with designation, territory and status in the meta.
- Accounts: title, meta, actions Import and Add; account-type `Tabs` with counts; an info banner for pending ones of the type ("12 new retailers wait for approval · Review them" filtering to pending); columns Code, Name, Territory, Parent, Assigned to, Location (verified or not as a badge), Outstanding, Status; the type's own fields and segments move to the account's page, as the prototype has it.
- [x] Tests for each.

### Task 3: finish

- [x] e2e mocks; `tools/ui-compare --only people,accounts`; 390 px in Hindi; the gallery; the progress row; the pull request and `pnpm verify`.
