# Phase 4 step B1: approval delegation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** an approver who will be away names a delegate for a range of days (M15: "Delegation during absence arrives in version 2"). While the delegation covers today, what waits for the approver also waits for the delegate. The delegate decides on the approver's behalf, and the chain and the audit say so (D109).

**Architecture:**
- **Applied on reading and deciding, never stored on steps.** A delegation never rewrites a step's approvers. It is checked whenever the inbox is read and whenever someone decides, so it starts, ends and is called off with nothing to undo.
- **The table:** `cell.approval_delegations` (delegator, delegate, `starts_on` and `ends_on` on the tenant's calendar, `ended_at` when called off early) belongs to the workflow module, through `DelegationsService`.
- **The inbox:** `ApprovalsService.waitingFor()` also matches a pending step whose approvers include someone who delegated to the caller for today.
- **Deciding:** `decide()` accepts such a delegate and records the step's `on_behalf_of`.
- **Notifications:** the waiting notification also reaches the approvers' delegates for that day.

**Spec:** M15; BR-31 (who decides); D74, D76; D109.

## Global constraints

- **Delegation rules** (`delegationIssues()` in `packages/shared/src/delegation.ts`, pure):
  - nobody delegates to themselves;
  - the delegate is active and may approve (holds `approval.act`);
  - the range starts today or later on the tenant's calendar, ends on or after its start, and spans at most 90 days;
  - a person has at most one delegation over any day, so no two overlap;
  - one hop only: a delegate's own delegation never passes the delegator's requests on.
- **Who:** a person delegates their own approvals (`approval.act`). Someone with `user.manage` may delegate for anyone their scope reaches, for a person suddenly away.
  - **Ending early:** the delegator, or such an admin, may end a delegation early. A delegate may not end one.
- **What a delegate may do:** decide what waits for the delegator, as the delegator could. That includes bulk approval. It excludes the delegate's own requests, which nobody decides.
- **Audit:** `approval.delegated` and `approval.delegation_ended`, plus `approval.decided` with `onBehalfOf`.
- **Answers:** `ApprovalStep.onBehalfOf` (who the decider stood in for), and `ApprovalResult.onBehalfOf` (in the caller's inbox, whom they would decide for; null when the request names them).
- **Portal:**
  - the approvals page gets a **While you're away** card: the current or coming delegation, setting one (a delegate picked from the people who may approve, and the days) and ending it;
  - inbox cards say **On behalf of …**;
  - a step decided this way reads "Decided by X for Y" in the chain.
- **Phone (pull request 2):** the approvals screen says On behalf of …. Setting a delegation stays on the portal.
- **Words:** English and Hindi.

## Review focus

1. **A delegation that hasn't started, or has ended:** nothing waits for the delegate. Tested.
2. **A delegate who is also the requester:** cannot decide their own request. Tested.
3. **Two approvers decide at once, one of them a delegate:** one wins (409 for the other), as today. Tested.
4. **The delegator acts while delegated:** may still decide; delegation adds a decider, never removes one. Tested.
5. **Another tenant:** cannot see or end a delegation. Cross-tenant fixture.

---

### Task 1: the rules and the table

- `delegationIssues()` and `DELEGATION_MAX_DAYS`, with tests.
- `cell.approval_delegations` with `tenant_id`, RLS, the `(tenant_id, id)` key and indexes led by `tenant_id`; `workflow_steps.on_behalf_of`; the migration.
- [x] Tests (unit): each rule.

### Task 2: the API

- **Routes** (`DelegationsController`):
  - `GET /v1/approval-delegations`: the caller's own, given and received, or a person's for `user.manage`;
  - `GET /v1/approval-delegations/candidates`: active people who may approve;
  - `POST /v1/approval-delegations` (client ID);
  - `POST /v1/approval-delegations/{id}/end`.
- **Approvals:** `ApprovalsService`'s inbox, counts, `get`, `decide` and bulk honour active delegations; `results()` fills `onBehalfOf`.
- **Notifications:** the waiting notification also reaches the delegates.
- Cross-tenant fixtures and `pnpm openapi`.
- [x] Tests (integration):
  - a delegate sees and decides the delegator's request, recorded on behalf;
  - before the dates and once ended, nothing waits;
  - the delegator still decides;
  - each rule refused;
  - an admin for another person in scope;
  - the cross-tenant fixtures.
  - A delegate's own request and the delegate's notification follow from `waitingFor()` and `withDelegates()` (the requester is left out of both) and aren't tested on their own.

### Task 3: the portal

- **While you're away** on the approvals page; **On behalf of** on inbox cards; the chain's wording.
- [x] Tests (Vitest and Playwright with axe): the badge, the chain's wording, handing over; axe with the card drawn.

### Task 4: the phone (pull request 2)

- On behalf of … on `/approvals` cards and the request's screen.
- [x] Tests (Jest): the badge on the card and the request's screen, and the chain's wording.

### Task 5: finish

- [ ] Decision D113, the progress row and tracker; `pnpm verify` before each merge.
