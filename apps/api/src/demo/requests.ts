import {
  type ApprovalResult,
  ApprovalInboxQuery,
  CreateExpenseClaimBody,
  CreateLeaveRequestBody,
  CreateRegularisationBody,
  newId,
} from '@thelamp/shared';
import { ExpenseClaimsService } from '../modules/expenses/expense-claims.service';
import { ExpensePoliciesService } from '../modules/expenses/expense-policies.service';
import { CalendarsService } from '../modules/field/calendars.service';
import { RegularisationsService } from '../modules/field/regularisations.service';
import { LeaveRequestsService } from '../modules/leave/leave-requests.service';
import { LeaveTypesService } from '../modules/leave/leave-types.service';
import { ApprovalsService } from '../modules/workflow/approvals.service';
import { SYSTEM_ACTOR } from '../platform/audit';
import type { DemoCommerce } from './commerce';
import { addDays, type DemoKit, type FieldPerson, type Person, weekdayOf } from './kit';

const HOLIDAY_NAMES = ['Company foundation day', 'Local festival'];
const FORGOT = [
  'Worked at the distributor’s godown all day; forgot to punch in.',
  'Phone battery died in the morning; visited my shops as planned.',
  'Spent the day at a farmer meeting in the village; no signal to punch in.',
];
const LEAVE_REASONS = ['Family function', 'Not feeling well', 'Personal work at the bank'];

/**
 * The people side of the demo (phase 2, decision D86): holidays on the default calendar, leave
 * asked for ahead, days fixed after a forgotten punch, the week's expense claims, their decisions
 * along each chain in the evening, and claims paid a week later. Days off and leave keep people
 * away from work, so attendance shows them as the rules say.
 */
export class DemoRequests {
  readonly holidays = new Set<string>();
  /** `userId|date` for each day of approved leave. */
  private readonly leaveDays = new Set<string>();
  /** `userId|date` for every day anyone has asked leave for, so nobody asks for one twice. */
  private readonly leaveRequested = new Set<string>();
  /** Each leave request still waiting, by its ID: whose and which days. */
  private readonly leaveAsked = new Map<string, { userId: string; days: string[] }>();
  /** The last day each person was away without leave, to fix the next morning. */
  private readonly missed = new Map<string, string>();
  /** The days each person worked since the last claim. */
  private readonly worked = new Map<string, string[]>();
  private readonly odometer = new Map<string, number>();
  /** Claims approved, by ID, with the day they were approved. */
  private readonly approvedClaims = new Map<string, string>();
  private readonly claimIds = new Set<string>();
  private leaveType: string | null = null;
  private perDay: string | null = null;
  private perKm: string | null = null;
  private counts = { leave: 0, fixes: 0, claims: 0, decisions: 0, paid: 0 };

  constructor(private readonly kit: DemoKit) {}

  get made() {
    return this.counts;
  }

  /** Two holidays in the span, and the leave type and expense policies people use. */
  async setUp(first: string, today: string): Promise<void> {
    const { kit } = this;
    const calendars = kit.get(CalendarsService);
    const found = await kit.tx((tx) => calendars.list(tx, kit.tenantId));
    const calendar = found.items.find((entry) => entry.default) ?? found.items[0];
    const span = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
    if (calendar && span >= 8) {
      const picks = [Math.floor(span / 3), Math.floor((2 * span) / 3)];
      const rows = picks
        .map((offset) => addDays(first, offset))
        .map((date) => {
          // Mid-week, so the week's end and its claims keep their Saturday.
          let day = date;
          while (
            [0, 6].includes(weekdayOf(day)) ||
            calendar.weeklyOffs.includes(weekdayOf(day) || 7)
          )
            day = addDays(day, 1);
          return day;
        })
        .map((date, index) => ({
          calendarKey: calendar.key,
          date,
          name: HOLIDAY_NAMES[index]!,
          optional: false,
          active: true,
        }));
      try {
        await kit.tx((tx) => calendars.writeHolidays(tx, kit.tenantId, SYSTEM_ACTOR, rows));
        for (const row of rows) this.holidays.add(row.date);
      } catch (error) {
        kit.once('holidays', error);
      }
    }
    const types = await kit.tx((tx) => kit.get(LeaveTypesService).list(tx, kit.tenantId));
    this.leaveType =
      types.find(
        (type) => type.active && type.paid && type.annualQuota > 0 && !type.attachmentAfterDays,
      )?.key ?? null;
    const policies = await kit.tx((tx) => kit.get(ExpensePoliciesService).list(tx, kit.tenantId));
    const active = policies.filter((policy) => policy.active && !policy.receiptRequired);
    this.perDay = active.find((policy) => policy.calculation === 'per_day')?.key ?? null;
    this.perKm = active.find((policy) => policy.calculation === 'per_km')?.key ?? null;
  }

  /** Whether the person is off on the day: a holiday, or approved leave. */
  off(person: Person, date: string): boolean {
    return this.holidays.has(date) || this.leaveDays.has(`${person.id}|${date}`);
  }

  workedOn(person: Person, date: string): void {
    this.worked.set(person.id, [...(this.worked.get(person.id) ?? []), date]);
  }

  missedDay(person: Person, date: string): void {
    this.missed.set(person.id, date);
  }

  /**
   * First thing in the morning: fixing yesterday's missed punch, and now and then asking for a
   * day or two of leave next week.
   */
  async morning(person: FieldPerson, date: string): Promise<void> {
    const { kit } = this;
    const missed = this.missed.get(person.id);
    if (missed && missed < date) {
      this.missed.delete(person.id);
      if (kit.dice.chance(0.7)) {
        try {
          await kit.tx((tx) =>
            kit.get(RegularisationsService).create(
              tx,
              person.access,
              CreateRegularisationBody.parse({
                id: newId(),
                date: missed,
                status: 'present',
                reason: kit.dice.pick(FORGOT),
              }),
            ),
          );
          this.counts.fixes++;
        } catch (error) {
          kit.once('regularisation', error);
        }
      }
    }
    if (this.leaveType && kit.dice.chance(0.05)) {
      let start = addDays(date, kit.dice.int(3, 8));
      while (weekdayOf(start) === 0 || this.holidays.has(start)) start = addDays(start, 1);
      const long = kit.dice.chance(0.4) && weekdayOf(start) !== 6;
      const end = long ? addDays(start, 1) : start;
      const halfDay = !long && kit.dice.chance(0.2);
      const days = long ? [start, end] : [start];
      // Days asked for already are refused, rightly; a person asks for fresh ones only.
      if (days.some((day) => this.leaveRequested.has(`${person.id}|${day}`))) return;
      const id = newId();
      try {
        await kit.tx((tx) =>
          kit.get(LeaveRequestsService).create(
            tx,
            person.access,
            CreateLeaveRequestBody.parse({
              id,
              leaveType: this.leaveType,
              startDate: start,
              endDate: end,
              halfDay,
              reason: kit.dice.pick(LEAVE_REASONS),
            }),
          ),
        );
        this.counts.leave++;
        for (const day of days) this.leaveRequested.add(`${person.id}|${day}`);
        // A half day still punches in; only whole days keep the person away.
        if (!halfDay) this.leaveAsked.set(id, { userId: person.id, days });
      } catch (error) {
        kit.once('leave', error);
      }
    }
  }

  /**
   * The week's claims, sent on its last working day: the daily allowance for the days worked, and
   * fuel by the odometer readings, with photos of both.
   */
  async weekEnd(person: FieldPerson, date: string): Promise<void> {
    const { kit } = this;
    const days = this.worked.get(person.id) ?? [];
    this.worked.delete(person.id);
    if (days.length === 0) return;
    const claims = kit.get(ExpenseClaimsService);
    const at = kit.at(date, 19 * 60);
    if (this.perDay) {
      const id = newId();
      try {
        await kit.tx((tx) =>
          claims.create(
            tx,
            person.access,
            CreateExpenseClaimBody.parse({
              id,
              policy: this.perDay,
              expenseDate: date,
              description: `Daily allowance for ${days.length} day${days.length === 1 ? '' : 's'} in ${person.market.name}`,
              days: String(days.length),
            }),
          ),
        );
        this.claimIds.add(id);
        this.counts.claims++;
      } catch (error) {
        kit.once('allowance claim', error);
      }
    }
    if (this.perKm) {
      const open = this.odometer.get(person.id) ?? kit.dice.int(12_000, 48_000);
      const close = open + days.length * kit.dice.int(35, 70);
      this.odometer.set(person.id, close);
      const where = { name: person.market.name, location: person.home };
      const photos = [
        await kit.photo(person, where, `Odometer ${open} km`, 'odometer', at - 3 * 60_000),
        await kit.photo(person, where, `Odometer ${close} km`, 'odometer', at - 2 * 60_000),
      ].filter((photo): photo is string => photo !== null);
      const id = newId();
      try {
        await kit.tx((tx) =>
          claims.create(
            tx,
            person.access,
            CreateExpenseClaimBody.parse({
              id,
              policy: this.perKm,
              expenseDate: date,
              description: `Fuel for the week's market visits around ${person.market.name}`,
              odometerOpen: String(open),
              odometerClose: String(close),
              odometerPhotoIds: photos,
            }),
          ),
        );
        this.claimIds.add(id);
        this.counts.claims++;
      } catch (error) {
        kit.once('fuel claim', error);
      }
    }
  }

  /**
   * The evening's decisions: each approver, from the managers up, works through what waits for
   * them, approving most and turning a few down; orders are decided on their own page.
   */
  async evening(approvers: Person[], date: string, commerce: DemoCommerce): Promise<void> {
    const { kit } = this;
    const approvals = kit.get(ApprovalsService);
    for (const approver of approvers) {
      let waiting: ApprovalResult[];
      try {
        waiting = (
          await kit.tx((tx) =>
            approvals.inbox(tx, approver.access, ApprovalInboxQuery.parse({ limit: 100 })),
          )
        ).items;
      } catch (error) {
        kit.once('inbox', error);
        continue;
      }
      for (const item of waiting) {
        if (item.requestType === 'order') {
          await commerce.decide(approver, item);
          this.counts.decisions++;
          continue;
        }
        if (!['leave', 'regularisation', 'expense', 'new_account'].includes(item.requestType)) {
          continue;
        }
        const reject = kit.dice.chance(item.requestType === 'expense' ? 0.05 : 0.08);
        try {
          const decided = await kit.tx((tx) =>
            approvals.decide(tx, approver.access, item.id, {
              decision: reject ? 'reject' : 'approve',
              version: item.version,
              ...(reject ? { note: 'Please speak to me about this first.' } : {}),
            }),
          );
          this.counts.decisions++;
          if (decided.status === 'approved') this.approved(item, date);
          if (decided.status !== 'pending') this.leaveAsked.delete(item.requestId);
        } catch (error) {
          kit.once(`${item.requestType} decision`, error);
        }
      }
    }
  }

  private approved(item: ApprovalResult, date: string): void {
    if (item.requestType === 'leave') {
      const asked = this.leaveAsked.get(item.requestId);
      for (const day of asked?.days ?? []) this.leaveDays.add(`${asked!.userId}|${day}`);
    }
    if (item.requestType === 'expense' && this.claimIds.has(item.requestId)) {
      this.approvedClaims.set(item.requestId, date);
    }
  }

  /** Claims approved a week or more ago are paid, with the bank's reference. */
  async pay(admin: Person, date: string): Promise<void> {
    const { kit } = this;
    for (const [id, approvedOn] of [...this.approvedClaims]) {
      if (approvedOn > addDays(date, -7)) continue;
      try {
        await kit.tx((tx) =>
          kit.get(ExpenseClaimsService).markPaid(tx, admin.access, id, {
            reference: `NEFT${date.replaceAll('-', '')}${kit.dice.int(1000, 9999)}`,
          }),
        );
        this.counts.paid++;
      } catch (error) {
        kit.once('claim payment', error);
      }
      this.approvedClaims.delete(id);
    }
  }
}
