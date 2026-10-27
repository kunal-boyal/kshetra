import { createHash, randomBytes } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { type FormView, signatureRequired } from '@thelamp/forms';
import {
  AppError,
  CreateAccountBody,
  CreateUserBody,
  type GeoPoint,
  type ItemResult,
  newId,
  ReviewQueueQuery,
  todayIn,
} from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Config } from '../config';
import { users } from '../db/schema/iam';
import { media } from '../db/schema/media';
import { AccountTypesService } from '../modules/accounts/account-types.service';
import { BillingSettings } from '../modules/billing/billing-settings.service';
import { EntitlementsService } from '../modules/billing/entitlements.service';
import { ExamplePlans } from '../modules/billing/example-plans';
import { AccountsService } from '../modules/accounts/accounts.service';
import { CatalogueService } from '../modules/catalogue/catalogue.service';
import { ItemsImport } from '../modules/catalogue/items.import';
import { SessionsService } from '../modules/directory/sessions.service';
import { DirectoryTenants } from '../modules/directory/tenants';
import { AttendanceService } from '../modules/field/attendance.service';
import { LocationsService } from '../modules/field/locations.service';
import { ShiftsService } from '../modules/field/shifts.service';
import { SubmissionsService } from '../modules/field/submissions.service';
import { VisitsService } from '../modules/field/visits.service';
import { FormsService } from '../modules/forms/forms.service';
import { SYSTEM } from '../modules/iam/actor';
import { DesignationsService } from '../modules/iam/designations.service';
import { UsersService } from '../modules/iam/users.service';
import { PhotosService } from '../modules/media/photos.service';
import { MetricsService } from '../modules/metrics/metrics.service';
import { PlanningService } from '../modules/planning/planning.service';
import { TargetsService } from '../modules/planning/targets.service';
import { ReviewService } from '../modules/review/review.service';
import { TenantConfigService } from '../modules/tenant-config/tenant-config.service';
import { TerritoriesService } from '../modules/territories/territories.service';
import { SYSTEM_ACTOR } from '../platform/audit';
import { type Access, AccessResolver } from '../platform/auth';
import { Database, type TenantTx } from '../platform/database';
import { startOfLocalDate } from '../platform/local-day';
import { ObjectStore } from '../platform/object-store';
import { MembershipSync } from '../platform/planes';
import { CONFIG } from '../platform/tokens';
import { onTravel, realNow, travelTo } from './clock';
import { DemoCommerce } from './commerce';
import {
  addDays,
  DAY,
  type DemoKit,
  type FieldPerson,
  MINUTE,
  type Person,
  type Place,
  weekdayOf,
} from './kit';
import {
  Dice,
  type Flavour,
  flavourOf,
  MARKETS,
  type Market,
  personName,
  personType,
  placeName,
  VILLAGES,
} from './names';
import { DemoRequests } from './requests';

export interface DemoOptions {
  slug: string;
  /** How many days back the activity starts. */
  days: number;
  seed: number;
  log: (line: string) => void;
}

type Field = FormView['fields'][number];

/**
 * Fills a demo tenant with a few weeks of fictional work (decision D70): territories around Nashik,
 * a team, distributors, shops and farmers, products, targets, daily plans, shifts with their
 * trails, visits, form entries with photos, and reviews. Everything goes through the app's own
 * services, as each person, on the day it happened, so the rules apply and the events that work
 * out attendance, metrics and leaderboards follow. Phase 2 adds price lists, orders and their
 * deliveries, statements, holidays, leave, fixed days and expense claims, decided along the
 * tenant's chains (`DemoCommerce`, `DemoRequests`). It reads the tenant's configuration rather than
 * assuming a template, and refuses any tenant that isn't a new demo tenant.
 */
export class DemoContent implements DemoKit {
  readonly dice: Dice;
  private readonly database: Database;
  private readonly config: Config;
  tenantId = '';
  timezone = 'Asia/Kolkata';
  private forms: FormView[] = [];
  private products: string[] = [];
  private items: ItemResult[] = [];
  /** The words of the tenant's industry (decision D97). */
  private flavour: Flavour = flavourOf('');
  private broken = new Set<string>();
  private readonly counts = {
    visits: 0,
    entries: 0,
    photos: 0,
    shifts: 0,
    reviews: 0,
    proposals: 0,
  };
  /** Types field people may propose and then hold, such as outlets (decision D97). */
  private proposable: Awaited<ReturnType<AccountTypesService['list']>> = [];
  private readonly commerce: DemoCommerce;
  private readonly requests: DemoRequests;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly options: DemoOptions,
  ) {
    this.dice = new Dice(options.seed);
    this.database = app.get(Database);
    this.config = app.get<Config>(CONFIG);
    // Storage signs each request with the time; it must be the real one, not the simulated day.
    const client = (
      app.get(ObjectStore) as unknown as { client?: { config?: { systemClockOffset?: number } } }
    ).client;
    onTravel((offset) => {
      if (client?.config) client.config.systemClockOffset = -offset;
    });
    this.commerce = new DemoCommerce(this);
    this.requests = new DemoRequests(this);
  }

  get<T>(type: abstract new (...args: never[]) => T): T {
    return this.app.get(type as never) as T;
  }

  tx<T>(work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.database.forTenant(this.tenantId, work);
  }

  /** Midnight of a date on the tenant's clock, plus `minutes`. */
  at(date: string, minutes: number): number {
    return startOfLocalDate(date, this.timezone).getTime() + minutes * MINUTE;
  }

  async run(): Promise<typeof this.counts & DemoCommerce['made'] & DemoRequests['made']> {
    const { log } = this.options;
    const tenant = await this.get(DirectoryTenants).bySlug(this.options.slug);
    if (!tenant) throw new Error(`There is no tenant ${this.options.slug}.`);
    if (!tenant.demo) {
      throw new Error(`${this.options.slug} isn't a demo tenant; only demo tenants are filled.`);
    }
    this.tenantId = tenant.id;
    this.flavour = flavourOf(tenant.templateKey);
    const people = await this.tx((tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.tenantId, this.tenantId)),
    );
    const places = await this.tx((tx) => this.get(TerritoriesService).list(tx, this.tenantId, {}));
    // A run that stopped part-way leaves some content; start again with a new demo tenant.
    if (people.length !== 1 || places.length > 0) {
      throw new Error(`${this.options.slug} has content already; make a new demo tenant instead.`);
    }
    const adminId = people[0]!.id;
    this.timezone = (
      await this.tx((tx) => this.get(TenantConfigService).settings(tx, this.tenantId))
    ).timezone;

    const today = todayIn(this.timezone);
    const first = new Date(Date.parse(`${today}T00:00:00Z`) - this.options.days * DAY)
      .toISOString()
      .slice(0, 10);
    travelTo(this.at(first, 7 * 60));
    const admin = await this.person(adminId, 'Admin');

    log('Products, territories and the team');
    await this.catalogue(admin);
    const team = await this.team(admin);
    log(`Places for ${team.length} field people`);
    for (const person of team) person.places = await this.placesFor(admin, person);
    log('Targets');
    await this.targets(team, first, today);
    // The demo tenant shows a plan in the console: the example Growth plan opens every module.
    const examples = await this.get(ExamplePlans).ensure();
    const growth = examples.get('growth');
    if (growth) {
      await this.get(EntitlementsService).set(null, this.tenantId, {
        planId: growth,
        extraModules: [],
        limits: {},
      });
    }
    // Fictional seller details, so the demo's console can show invoicing (decision D90).
    await this.get(BillingSettings).ensureExample();
    log('Price lists, opening balances and holidays');
    await this.commerce.setUp(admin, team, first);
    await this.requests.setUp(first, today);
    // Who decides requests, from the managers up to the business head and the admin.
    const approvers = [
      ...new Map(team.map((person) => [person.manager.id, person.manager])).values(),
      ...this.managers.map((manager) => manager.person),
      admin,
    ].filter((person, index, all) => all.findIndex((each) => each.id === person.id) === index);

    for (let day = Date.parse(`${first}T00:00:00Z`); ; day += DAY) {
      const date = new Date(day).toISOString().slice(0, 10);
      if (date > today) break;
      const weekday = weekdayOf(date);
      const working = weekday !== 0 && !this.requests.holidays.has(date);
      if (working) {
        for (const person of team) {
          travelTo(this.at(date, 7 * 60 + 45));
          await this.requests.morning(person, date);
          if (this.requests.off(person, date)) continue;
          await this.workday(person, date, date === today);
        }
        for (const manager of this.managers) await this.managerDay(manager, date, date === today);
        await this.review(team, date, today);
      }
      // The week closes on Saturday evening, holiday or not.
      if (weekday === 6 && date < today) {
        for (const person of team) await this.requests.weekEnd(person, date);
        travelTo(this.at(date, 19 * 60 + 15));
        await this.commerce.weekEnd(admin, date);
        await this.requests.pay(admin, date);
      }
      if (working) await this.decisions(approvers, date, today);
      if (date < today) await this.endOfDay(date);
      log(`${date}: ${this.counts.visits} visits, ${this.counts.entries} entries so far`);
    }
    travelTo(realNow());
    await this.releasePhones(admin);
    return { ...this.counts, ...this.commerce.made, ...this.requests.made };
  }

  /** The evening's decisions along the chains, except the last two days', which wait. */
  private async decisions(approvers: Person[], date: string, today: string): Promise<void> {
    const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY;
    if (ageDays < 2) return;
    travelTo(this.at(date, 20 * 60));
    await this.requests.evening(approvers, date, this.commerce);
  }

  /** Someone's access, on their phone when they have one. */
  private async person(id: string, name: string, deviceId?: string): Promise<Person> {
    const access = await this.get(AccessResolver).onBehalfOf(
      this.tenantId,
      id,
      this.config.CELL_ID,
    );
    return { id, name, access: deviceId ? { ...access, deviceId } : access };
  }

  /** Signs a person in on a fictional phone, which registers it as theirs, and returns its ID. */
  private async phoneOf(phone: string): Promise<string> {
    const device = {
      key: randomBytes(32).toString('base64url'),
      platform: 'android' as const,
      model: 'Demo phone',
    };
    const sessions = this.get(SessionsService);
    const result = await sessions.signIn(phone, device);
    if (result.status !== 'signed_in') throw new Error('A demo person could not sign in.');
    const claims = JSON.parse(
      Buffer.from(result.session.accessToken.split('.')[1]!, 'base64url').toString(),
    ) as { did?: string };
    if (!claims.did) throw new Error('The demo phone was not registered.');
    return claims.did;
  }

  /** A few fictional products, when a form offers the catalogue's or lists items and it has none. */
  private async catalogue(admin: Person): Promise<void> {
    this.forms = (await this.tx((tx) => this.get(FormsService).list(tx, this.tenantId))).filter(
      (form) => form.active,
    );
    const wanted = this.forms.some((form) =>
      form.fields.some(
        (field) => ('optionsFrom' in field && field.optionsFrom) || field.type === 'product_lines',
      ),
    );
    const existing = await this.tx((tx) => this.get(CatalogueService).items(tx, this.tenantId));
    if (wanted && existing.length === 0) {
      const settings = await this.tx((tx) =>
        this.get(CatalogueService).settings(tx, this.tenantId),
      );
      const unit = settings.units.find((each) => each.base)?.key ?? 'pack';
      const rows = this.flavour.products.map((product, index) => ({
        row: index + 2,
        cells: {
          item_code: product.code,
          item_name: `${product.product} ${product.pack}`,
          product_name: product.product,
          pack_label: product.pack,
          base_unit: unit,
          tax_rate: product.taxRate,
          mrp: product.mrp,
        },
      }));
      await this.tx((tx) =>
        this.get(ItemsImport).commit(tx, rows, {
          access: admin.access,
          target: 'items',
          emptyValues: [],
          fractions: [],
        }),
      );
    }
    const items = await this.tx((tx) => this.get(CatalogueService).items(tx, this.tenantId));
    this.items = items.filter((item) => item.active);
    this.products = [...new Set(items.map((item) => item.product.id))];
  }

  /**
   * Territories from the top level down to markets, and a team: a manager at each manager level
   * above the lowest, one under the other, two group managers of the lowest level and four field
   * people under each, the demo numbers among them, so chains and slots naming any manager level
   * find someone.
   */
  private async team(admin: Person): Promise<FieldPerson[]> {
    const { levels, designations } = await this.tx(async (tx) => ({
      levels: await this.get(TerritoriesService).levels(tx, this.tenantId),
      designations: await this.get(DesignationsService).list(tx, this.tenantId),
    }));
    const byLevel = [...designations].sort((a, b) => a.level - b.level);
    // The ranked field designation, such as a DSR rather than a merchandiser.
    const fieldUsers = [...byLevel].reverse().filter((each) => each.defaultRole === 'field_user');
    const field = fieldUsers.find((each) => each.ranked) ?? fieldUsers[0];
    const managers = byLevel.filter((each) => each.defaultRole === 'manager');
    if (!field) throw new Error('The tenant has no designation for field users.');
    this.proposable = (
      await this.tx((tx) => this.get(AccountTypesService).list(tx, this.tenantId))
    ).filter(
      (type) =>
        type.active &&
        type.definition.creation === 'field_users_with_approval' &&
        type.definition.slots.some((slot) => slot.designations.includes(field.key)) &&
        !type.definition.slots.some((slot) => slot.required),
    );
    const lowest = managers.at(-1)?.level;
    const group = managers.find((each) => each.level === lowest);
    // One designation for each manager level above the group's, the highest first.
    const upper = managers.filter(
      (each, index) =>
        lowest !== undefined &&
        each.level < lowest &&
        managers.findIndex((other) => other.level === each.level) === index,
    );

    const territories = this.get(TerritoriesService);
    const add = (code: string, name: string, parentId: string | null) =>
      this.tx((tx) => territories.add(tx, this.tenantId, SYSTEM_ACTOR, { code, name, parentId }));
    const sorted = [...levels].sort((a, b) => a.level - b.level);
    let parent: string | null = null;
    const above = sorted.slice(0, Math.max(0, sorted.length - 2));
    for (const [index, level] of above.entries()) {
      const names = ['West', 'Maharashtra', 'Nashik', 'Nashik District'];
      parent = (
        await add(`D-${level.key.slice(0, 8).toUpperCase()}`, names[index] ?? level.key, parent)
      ).id;
    }
    const groups =
      sorted.length >= 2
        ? [await add('D-NSK-E', 'Nashik East', parent), await add('D-NSK-W', 'Nashik West', parent)]
        : [];
    const markets: { market: Market; node: { id: string } }[] = [];
    for (const [index, market] of MARKETS.entries()) {
      const node = await add(`D-${market.code}`, market.name, groups[index % 2]?.id ?? parent);
      this.marketNode.set(market.code, node.id);
      markets.push({ market, node });
    }

    // A number signs in to one organisation (decision D103), so a demo number already in another
    // tenant leaves its slot to a fictional one, and fictional numbers skip those taken elsewhere.
    const members = this.get(MembershipSync);
    const allDemo = [...this.config.DEMO_CODES.keys()].sort();
    const demoTaken = await members.activeElsewhere(allDemo, this.tenantId);
    const demoNumbers = allDemo.map((number) => (demoTaken.has(number) ? undefined : number));
    const candidates = Array.from({ length: 1_000 }, (_, i) => `+9170000${String(10_001 + i)}`);
    const taken = await members.activeElsewhere(candidates, this.tenantId);
    const fictional = candidates.filter((number) => !taken.has(number));
    const phoneFor = (slot: number) => {
      const number = demoNumbers[slot] ?? fictional.shift();
      if (!number) throw new Error('No fictional numbers are left for the demo team.');
      return number;
    };
    const create = (input: Record<string, unknown>) =>
      this.tx((tx) =>
        this.get(UsersService).create(tx, this.tenantId, SYSTEM, CreateUserBody.parse(input)),
      );
    const joined = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);

    let headPerson: Person = admin;
    const heads: { id: string; designation: string }[] = [];
    for (const [index, level] of upper.entries()) {
      const name = personName(this.dice);
      const headPhone = phoneFor(99);
      const made = await create({
        code: index === upper.length - 1 ? 'DEMO-HM' : `DEMO-H${index + 1}`,
        name,
        phone: headPhone,
        designation: level.key,
        role: 'manager',
        managerId: headPerson.id,
        joiningDate: joined,
        territoryIds: parent ? [parent] : [],
      });
      headPerson = await this.person(made.id, name, await this.phoneOf(headPhone));
      this.managers.push({ person: headPerson, home: this.near(MARKETS[0], 0.01) });
      heads.unshift({ id: headPerson.id, designation: level.key });
    }
    const team: FieldPerson[] = [];
    for (const [index, groupNode] of (groups.length > 0 ? groups : [null]).entries()) {
      // The first group's manager signs in with the second demo number.
      const managerName = index === 0 && demoNumbers[1] ? 'Rajesh Patil' : personName(this.dice);
      const managerPhone = index === 0 ? phoneFor(1) : phoneFor(98);
      const madeManager = await create({
        code: `DEMO-M${index + 1}`,
        name: managerName,
        phone: managerPhone,
        designation: (group ?? field).key,
        role: 'manager',
        managerId: headPerson.id,
        joiningDate: joined,
        territoryIds: groupNode ? [groupNode.id] : [],
      });
      const manager = await this.person(
        madeManager.id,
        managerName,
        await this.phoneOf(managerPhone),
      );
      if (this.config.DEMO_CODES.has(managerPhone)) this.demoUsers.add(manager.id);
      const own = markets.filter((_, slot) => slot % Math.max(groups.length, 1) === index);
      this.managers.push({
        person: manager,
        home: this.near(own[0]?.market ?? MARKETS[0], 0.01),
      });
      for (const [slot, { market, node }] of own.entries()) {
        // The first field person of the first group signs in with the third demo number.
        const demo = index === 0 && slot === 0;
        const name = demo && demoNumbers[2] ? 'Sachin More' : personName(this.dice);
        const phone = demo ? phoneFor(2) : phoneFor(97);
        const made = await create({
          code: `DEMO-F${team.length + 1}`,
          name,
          phone,
          designation: field.key,
          role: 'field_user',
          managerId: manager.id,
          joiningDate: joined,
          territoryIds: [node.id],
        });
        const person = await this.person(made.id, name, await this.phoneOf(phone));
        if (this.config.DEMO_CODES.has(phone)) this.demoUsers.add(person.id);
        team.push({
          ...person,
          market,
          home: this.near(market, 0.01),
          manager,
          places: [],
        });
      }
    }
    // Everyone's chain, for filling account slots by designation.
    this.chain = new Map(
      team.map((person) => [
        person.id,
        [
          { id: person.id, designation: field.key },
          { id: person.manager.id, designation: (group ?? field).key },
          ...heads,
        ],
      ]),
    );
    return team;
  }

  private chain = new Map<string, { id: string; designation: string }[]>();
  /** Managers, who punch in too, each from their own town. */
  private managers: { person: Person; home: GeoPoint }[] = [];
  /** People with demo numbers, whose fictional phones are released at the end. */
  private demoUsers = new Set<string>();

  private near(centre: { lat: number; lng: number }, spread: number): GeoPoint {
    return {
      lat: Number((centre.lat + (this.dice.next() - 0.5) * 2 * spread).toFixed(6)),
      lng: Number((centre.lng + (this.dice.next() - 0.5) * 2 * spread).toFixed(6)),
    };
  }

  /**
   * The accounts in the person's market, in their slots: suppliers, the businesses they supply,
   * and people such as farmers or doctors, named in the tenant's industry's words.
   */
  private async placesFor(admin: Person, person: FieldPerson): Promise<Place[]> {
    const types = (
      await this.tx((tx) => this.get(AccountTypesService).list(tx, this.tenantId))
    ).filter((type) => type.active);
    const parents = new Set(types.flatMap((type) => type.definition.parentTypes ?? []));
    const ordered = [...types].sort(
      (a, b) => (a.definition.parentTypes?.length ?? 0) - (b.definition.parentTypes?.length ?? 0),
    );
    const places: Place[] = [];
    for (const type of ordered) {
      const key = type.key;
      const isParent = parents.has(key);
      const isPerson = personType(key);
      const count = isParent ? 2 : isPerson ? 6 : 4;
      const typeName = type.definition.name.en.one;
      const slots: Record<string, string> = {};
      for (const slot of type.definition.slots ?? []) {
        const holder = this.chain
          .get(person.id)
          ?.find((each) => slot.designations.includes(each.designation));
        if (holder) slots[slot.key] = holder.id;
      }
      if ((type.definition.slots ?? []).some((slot) => slot.required && !slots[slot.key])) continue;
      for (let index = 0; index < count; index++) {
        const name = placeName(
          this.dice,
          this.flavour,
          typeName,
          isParent ? 'supplier' : isPerson ? 'person' : 'shop',
          person.market.name,
        );
        const location = this.near(person.market, isPerson ? 0.05 : 0.025);
        const parentType = type.definition.parentTypes?.[0];
        const parent = parentType
          ? (places.find((place) => place.type === parentType && this.dice.chance(0.6)) ??
            places.find((place) => place.type === parentType))
          : undefined;
        const id = newId();
        try {
          await this.tx((tx) =>
            this.get(AccountsService).create(
              tx,
              admin.access,
              CreateAccountBody.parse({
                id,
                type: key,
                code: `${key.slice(0, 3).toUpperCase()}-${person.market.code}-${String(index + 1).padStart(2, '0')}`,
                name,
                territoryId: this.marketNode.get(person.market.code)!,
                location,
                slots,
                ...(parent ? { parentId: parent.id } : {}),
                custom: this.values(
                  type.definition.fields ?? [],
                  { place: name, market: person.market.name },
                  true,
                ),
              }),
            ),
          );
          places.push({
            id,
            name,
            type: key,
            location,
            ...(parent ? { parentId: parent.id } : {}),
            held: Object.values(slots).includes(person.id),
          });
        } catch (error) {
          this.once(`account:${key}`, error);
        }
      }
    }
    return places;
  }

  private marketNode = new Map<string, string>();

  once(key: string, error: unknown): void {
    if (this.broken.has(key)) return;
    this.broken.add(key);
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const detail =
      error instanceof AppError
        ? `${error.code}: ${error.message} ${JSON.stringify(error.details ?? [])}`
        : `${String(error)}${status ? ` (HTTP ${status})` : ''}`;
    this.options.log(`Skipping ${key}: ${detail}`);
  }

  /** Each month's targets, set by each person's manager and locked. */
  private async targets(team: FieldPerson[], first: string, today: string): Promise<void> {
    const metrics = await this.tx((tx) => this.get(MetricsService).targetable(tx, this.tenantId));
    if (metrics.length === 0) return;
    const periods = [...new Set([first.slice(0, 7), today.slice(0, 7)])];
    const managers = new Map(team.map((person) => [person.manager.id, person.manager]));
    for (const period of periods) {
      for (const manager of managers.values()) {
        const own = team.filter((person) => person.manager.id === manager.id);
        const sets = own.map((person) => ({
          userId: person.id,
          version: 0,
          values: Object.fromEntries(metrics.map((metric) => [metric.key, this.target(metric)])),
        }));
        try {
          await this.tx((tx) => this.get(TargetsService).put(tx, manager.access, { period, sets }));
          await this.tx((tx) =>
            this.get(TargetsService).lock(tx, manager.access, {
              period,
              userIds: own.map((person) => person.id),
            }),
          );
        } catch (error) {
          this.once(`targets:${period}`, error);
        }
      }
    }
  }

  private target(metric: { key: string; unit: string }): string {
    const vary = (base: number) => Math.round(base * (0.8 + this.dice.next() * 0.4));
    if (metric.unit === 'currency') {
      const base = /collect/.test(metric.key)
        ? 450_000
        : /liquid/.test(metric.key)
          ? 350_000
          : 600_000;
      return String(vary(base));
    }
    if (metric.unit === 'percent') return '85';
    if (/day/.test(metric.key)) return '24';
    if (/appoint|new/.test(metric.key)) return '2';
    if (/distributor/.test(metric.key)) return '6';
    return String(vary(110));
  }

  /** One person's day: punch in, the planned visits with their entries, punch out. */
  private async workday(person: FieldPerson, date: string, isToday: boolean): Promise<void> {
    // People call on the accounts they hold; others, such as a manager's stockists, wait.
    const calls = person.places.filter((place) => place.held);
    if (calls.length === 0) return;
    if (this.dice.chance(0.06)) {
      // Away without a punch: the person may ask to fix the day tomorrow.
      if (!isToday) this.requests.missedDay(person, date);
      return;
    }
    const stops = this.dice.shuffle(calls).slice(0, this.dice.int(5, 7));
    // The manager plans the day first thing.
    travelTo(this.at(date, 8 * 60));
    const plan = new Map<string, string>();
    for (const stop of stops.slice(0, -1)) {
      const id = newId();
      try {
        await this.tx((tx) =>
          this.get(PlanningService).create(tx, person.manager.access, {
            id,
            userId: person.id,
            accountId: stop.id,
            date,
          }),
        );
        plan.set(stop.id, id);
      } catch (error) {
        this.once('plan', error);
      }
    }

    let now = this.at(date, 9 * 60 + 15 + this.dice.int(0, 30));
    const stopAt = isToday ? Math.min(realNow(), this.at(date, 18 * 60 + 30)) : Infinity;
    if (now > stopAt) return;
    travelTo(now);
    const shiftId = newId();
    try {
      await this.tx((tx) =>
        this.get(ShiftsService).start(
          tx,
          person.access,
          {
            id: shiftId,
            startedAt: new Date(now).toISOString(),
            location: person.home,
            accuracy: 12,
            mocked: false,
            consentVersion: '2026-10',
          },
          new Date(now).toISOString(),
        ),
      );
      this.counts.shifts++;
      this.requests.workedOn(person, date);
    } catch (error) {
      this.once('shift', error);
      return;
    }

    let here = person.home;
    let trail: { at: number; point: GeoPoint }[] = [{ at: now, point: here }];
    for (const stop of stops) {
      const travel = this.dice.int(12, 28) * MINUTE;
      if (now + travel + 20 * MINUTE > stopAt) break;
      trail.push(...this.route(here, stop.location, now, now + travel));
      now += travel;
      here = stop.location;
      travelTo(now);
      await this.points(person, shiftId, trail);
      trail = [];
      await this.visit(person, stop, plan.get(stop.id), now);
      now += this.dice.int(18, 35) * MINUTE;
      trail.push({ at: now, point: this.near(stop.location, 0.0003) });
      // Now and then an activity on the way, such as a farmer meeting in a village or a CME.
      const activities = this.forms.filter((form) => form.accountLink.mode === 'none');
      if (
        activities.length > 0 &&
        this.dice.chance(this.flavour.activityChance) &&
        now + 60 * MINUTE < stopAt
      ) {
        const village = {
          id: '',
          name: this.dice.pick(this.flavour.gatherings),
          type: '',
          location: this.near(person.market, 0.04),
        };
        const walk = this.dice.int(10, 20) * MINUTE;
        trail.push(...this.route(here, village.location, now, now + walk));
        now += walk;
        here = village.location;
        travelTo(now);
        await this.points(person, shiftId, trail);
        trail = [];
        await this.entry(person, village, this.dice.pick(activities), null, now + 10 * MINUTE);
        now += this.dice.int(25, 45) * MINUTE;
      }
    }
    // Now and then a new account found on the way, proposed for the manager to decide.
    if (this.proposable.length > 0 && this.dice.chance(0.15) && now + 30 * MINUTE < stopAt) {
      now += 15 * MINUTE;
      await this.propose(person, now);
    }
    const end = Math.max(now + 20 * MINUTE, this.at(date, 18 * 60 + this.dice.int(0, 40)));
    if (end > stopAt) {
      // Today's shift stays open: the person is on duty now.
      travelTo(Math.min(now, realNow()));
      await this.points(person, shiftId, trail);
      return;
    }
    trail.push(...this.route(here, person.home, now, end));
    travelTo(end);
    await this.points(person, shiftId, trail);
    await this.tx((tx) =>
      this.get(ShiftsService).end(
        tx,
        person.access,
        shiftId,
        {
          endedAt: new Date(end).toISOString(),
          location: person.home,
          accuracy: 14,
          mocked: false,
        },
        new Date(end).toISOString(),
      ),
    ).catch((error: unknown) => this.once('shift end', error));
  }

  /** A new account the person proposes, of a type they may propose and hold (decision D97). */
  private async propose(person: FieldPerson, at: number): Promise<void> {
    travelTo(at);
    const type = this.dice.pick(this.proposable);
    const parentType = type.definition.parentTypes?.[0];
    const parent = parentType
      ? person.places.find((place) => place.type === parentType)
      : undefined;
    const name = placeName(
      this.dice,
      this.flavour,
      type.definition.name.en.one,
      personType(type.key) ? 'person' : 'shop',
      person.market.name,
    );
    try {
      await this.tx((tx) =>
        this.get(AccountsService).create(
          tx,
          person.access,
          CreateAccountBody.parse({
            id: newId(),
            type: type.key,
            ...(type.definition.code.mode === 'manual'
              ? { code: `NEW-${person.market.code}-${this.dice.int(1000, 9999)}` }
              : {}),
            name,
            territoryId: this.marketNode.get(person.market.code)!,
            location: this.near(person.market, 0.03),
            ...(parent ? { parentId: parent.id } : {}),
            custom: this.values(
              type.definition.fields ?? [],
              { place: name, market: person.market.name },
              true,
            ),
          }),
        ),
      );
      this.counts.proposals++;
    } catch (error) {
      this.once(`proposal:${type.key}`, error);
    }
  }

  /** A manager's day: punch in, out to a market and back, punch out. */
  private async managerDay(
    manager: { person: Person; home: GeoPoint },
    date: string,
    isToday: boolean,
  ): Promise<void> {
    if (this.dice.chance(0.05)) return;
    const start = this.at(date, 9 * 60 + 30 + this.dice.int(0, 30));
    const stopAt = isToday ? realNow() : Infinity;
    if (start > stopAt) return;
    const { access } = manager.person;
    const shiftId = newId();
    travelTo(start);
    const punch = { location: manager.home, accuracy: 15, mocked: false };
    try {
      await this.tx((tx) =>
        this.get(ShiftsService).start(
          tx,
          access,
          {
            id: shiftId,
            startedAt: new Date(start).toISOString(),
            consentVersion: '2026-10',
            ...punch,
          },
          new Date(start).toISOString(),
        ),
      );
      this.counts.shifts++;
    } catch (error) {
      this.once('manager shift', error);
      return;
    }
    const market = this.near(this.dice.pick(MARKETS), 0.02);
    const end = this.at(date, 18 * 60 + this.dice.int(0, 50));
    const out = this.route(manager.home, market, start, start + 4 * 60 * MINUTE);
    const back = this.route(market, manager.home, start + 5 * 60 * MINUTE, end);
    if (end > stopAt) {
      travelTo(stopAt);
      await this.points(
        manager.person,
        shiftId,
        out.filter((point) => point.at <= stopAt),
      );
      return;
    }
    travelTo(end);
    await this.points(manager.person, shiftId, [...out, ...back]);
    await this.tx((tx) =>
      this.get(ShiftsService).end(
        tx,
        access,
        shiftId,
        { endedAt: new Date(end).toISOString(), ...punch },
        new Date(end).toISOString(),
      ),
    ).catch((error: unknown) => this.once('manager shift end', error));
  }

  /**
   * The demo numbers' people were signed in on fictional phones to work; releasing those phones
   * lets the real phones a demo is given on sign in (BR-38 binds one phone a person).
   */
  private async releasePhones(admin: Person): Promise<void> {
    for (const id of this.demoUsers) {
      await this.tx((tx) => this.get(UsersService).resetDevice(tx, admin.access, id)).catch(
        (error: unknown) => this.once('release phone', error),
      );
    }
  }

  /** Points every few minutes on the way, with a little wander. */
  private route(from: GeoPoint, to: GeoPoint, start: number, end: number) {
    const points: { at: number; point: GeoPoint }[] = [];
    const steps = Math.max(1, Math.round((end - start) / (5 * MINUTE)));
    for (let step = 1; step <= steps; step++) {
      const share = step / steps;
      points.push({
        at: start + ((end - start) * step) / steps,
        point: this.near(
          {
            lat: from.lat + (to.lat - from.lat) * share,
            lng: from.lng + (to.lng - from.lng) * share,
          },
          0.0008,
        ),
      });
    }
    return points;
  }

  private async points(
    person: { access: Access },
    shiftId: string,
    trail: { at: number; point: GeoPoint }[],
  ) {
    for (let index = 0; index < trail.length; index += 200) {
      const batch = trail.slice(index, index + 200).map(({ at, point }) => ({
        id: newId(),
        shiftId,
        capturedAt: new Date(at).toISOString(),
        location: point,
        accuracy: this.dice.int(6, 25),
        speed: Number((this.dice.next() * 9).toFixed(1)),
        mocked: false,
        source: 'background' as const,
        battery: this.dice.int(30, 95),
      }));
      if (batch.length === 0) continue;
      await this.tx((tx) =>
        this.get(LocationsService).ingest(tx, person.access, { points: batch }),
      ).catch((error: unknown) => this.once('points', error));
    }
  }

  private fix(point: GeoPoint, at: number) {
    return {
      location: this.near(point, 0.0002),
      accuracy: this.dice.int(6, 20),
      mocked: false,
      capturedAt: new Date(at).toISOString(),
    };
  }

  /** Check in, fill a form that fits the place, check out. */
  private async visit(
    person: FieldPerson,
    place: Place,
    planItemId: string | undefined,
    arrived: number,
  ) {
    const visitId = newId();
    travelTo(arrived);
    try {
      await this.tx((tx) =>
        this.get(VisitsService).checkIn(
          tx,
          person.access,
          {
            id: visitId,
            accountId: place.id,
            checkedInAt: new Date(arrived).toISOString(),
            fix: this.fix(place.location, arrived),
            ...(planItemId ? { planItemId } : {}),
          },
          new Date(arrived).toISOString(),
        ),
      );
      this.counts.visits++;
    } catch (error) {
      this.once('visit', error);
      return;
    }
    const linked = this.forms.filter(
      (form) =>
        form.accountLink.mode !== 'none' && form.accountLink.accountTypes.includes(place.type),
    );
    const standalone = this.forms.filter((form) => form.accountLink.mode === 'none');
    const form =
      linked.length > 0
        ? this.dice.pick(linked)
        : standalone.length > 0
          ? this.dice.pick(standalone)
          : null;
    // The order first, so the form knows whether the visit took one (decision D97).
    const orderedAt = arrived + this.dice.int(6, 10) * MINUTE;
    travelTo(orderedAt);
    const ordered = await this.commerce.atVisit(
      person,
      place,
      visitId,
      orderedAt,
      this.fix(place.location, orderedAt),
    );
    if (form && !this.broken.has(`form:${form.key}`)) {
      const inVisit = linked.includes(form);
      await this.entry(
        person,
        place,
        form,
        inVisit ? visitId : null,
        arrived + this.dice.int(12, 16) * MINUTE,
        inVisit ? ordered : undefined,
      );
    }
    const left = arrived + this.dice.int(18, 32) * MINUTE;
    travelTo(left);
    await this.tx((tx) =>
      this.get(VisitsService).checkOut(tx, person.access, visitId, {
        checkedOutAt: new Date(left).toISOString(),
        fix: this.fix(place.location, left),
      }),
    ).catch((error: unknown) => this.once('check-out', error));
  }

  private async entry(
    person: FieldPerson,
    place: Place,
    form: FormView,
    visitId: string | null,
    at: number,
    visitOrdered?: boolean,
  ) {
    travelTo(at);
    const photos: string[] = [];
    const limits = form.photos ?? { min: 0, max: 0 };
    const wanted = limits.min + (this.dice.chance(0.3) ? 1 : 0);
    for (let index = 0; index < Math.min(wanted, limits.max); index++) {
      const id = await this.photo(
        person,
        place,
        form.name.en.one,
        'evidence',
        at - (index + 1) * MINUTE,
      );
      if (id) photos.push(id);
    }
    travelTo(at);
    const values = this.values(
      form.fields,
      { place: place.name, market: person.market.name },
      false,
    );
    try {
      await this.tx((tx) =>
        this.get(SubmissionsService).create(
          tx,
          person.access,
          {
            id: newId(),
            form: { key: form.key, version: form.version },
            ...(visitId ? { accountId: place.id, visitId } : {}),
            capturedAt: new Date(at).toISOString(),
            fix: this.fix(place.location, at),
            values,
            photos,
            ...(signatureRequired(form, values, { visitOrdered })
              ? { signature: this.signature() }
              : {}),
          },
          new Date(at).toISOString(),
        ),
      );
      this.counts.entries++;
    } catch (error) {
      // Values the form refuses would be refused every time; anything else may pass next time.
      const refused = error instanceof AppError && error.code === 'VALIDATION';
      this.once(refused ? `form:${form.key}` : `entry:${form.key}`, error);
    }
  }

  /** A photo the person takes: a picture of shapes in the place's own colours, never repeated. */
  async photo(
    person: Person,
    place: { name: string; location: GeoPoint },
    caption: string,
    kind: 'evidence' | 'receipt' | 'odometer',
    at: number,
  ): Promise<string | null> {
    travelTo(at);
    const hue = this.dice.int(0, 359);
    const shapes = Array.from({ length: 14 }, () => {
      const x = this.dice.int(0, 960);
      const y = this.dice.int(0, 720);
      const size = this.dice.int(40, 260);
      const colour = `hsl(${(hue + this.dice.int(-60, 60) + 360) % 360},${this.dice.int(35, 75)}%,${this.dice.int(30, 70)}%)`;
      return this.dice.chance(0.5)
        ? `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${colour}"/>`
        : `<rect x="${x}" y="${y}" width="${size}" height="${Math.round(size * 0.7)}" rx="18" fill="${colour}"/>`;
    }).join('');
    const label = `${caption} · ${place.name}`.replace(/[<&>"]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="hsl(${hue},30%,88%)"/>${shapes}<rect x="0" y="640" width="960" height="80" fill="rgba(0,0,0,0.45)"/><text x="24" y="690" font-family="sans-serif" font-size="30" fill="#fff">Demo photo · ${label}</text></svg>`;
    const bytes = new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toBuffer());
    const id = newId();
    try {
      await this.tx((tx) =>
        this.get(PhotosService).presign(tx, person.access, {
          id,
          kind,
          contentType: 'image/jpeg',
          size: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      const [row] = await this.tx((tx) =>
        tx
          .select({ objectKey: media.objectKey })
          .from(media)
          .where(and(eq(media.tenantId, this.tenantId), eq(media.id, id))),
      );
      await this.get(ObjectStore).put(row!.objectKey, bytes, 'image/jpeg');
      await this.tx((tx) =>
        this.get(PhotosService).confirm(tx, person.access, id, {
          capturedAt: new Date(at).toISOString(),
          source: 'camera',
          fix: {
            ...this.near(place.location, 0.0002),
            accuracy: 12,
            capturedAt: new Date(at).toISOString(),
            mocked: false,
          },
        }),
      );
      this.counts.photos++;
      return id;
    } catch (error) {
      this.once('photo', error);
      return null;
    }
  }

  /** Plausible values for a form's fields; complex fields are left out unless required. */
  private values(
    fields: readonly Field[],
    context: { place: string; market: string },
    onlyRequired: boolean,
  ) {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      if (onlyRequired && !('required' in field && field.required)) continue;
      const key = field.key;
      switch (field.type) {
        case 'short_text':
          values[key] = /topic|subject/.test(key)
            ? this.dice.pick(this.flavour.topics)
            : /phone|mobile/.test(key)
              ? `9${String(this.dice.int(10_000_000, 99_999_999))}0`
              : /outlet|shop|store|firm|business/.test(key)
                ? placeName(this.dice, this.flavour, '', 'shop', context.market)
                : /farmer|name|contact|person|owner/.test(key)
                  ? personName(this.dice)
                  : /village/.test(key)
                    ? this.dice.pick(VILLAGES)
                    : /market|town|area/.test(key)
                      ? context.market
                      : /reference|ref/.test(key)
                        ? `REF-${this.dice.int(1000, 9999)}`
                        : context.place;
          break;
        case 'long_text':
          values[key] = /observ/.test(key)
            ? this.dice.pick(this.flavour.observations)
            : this.dice.pick(this.flavour.outcomes);
          break;
        case 'number': {
          const min = field.min ?? 0;
          const max = field.max ?? min + 60;
          const whole = (field.decimals ?? 0) === 0;
          const value = min + this.dice.next() * (max - min);
          values[key] = whole
            ? Math.max(Math.ceil(min), Math.round(value))
            : Number(value.toFixed(field.decimals ?? 2));
          break;
        }
        case 'currency': {
          const base = /sales|order|value/.test(key)
            ? 40_000
            : /collect/.test(key)
              ? 30_000
              : 22_000;
          values[key] = String(Math.round(base * (0.3 + this.dice.next() * 1.4)));
          break;
        }
        case 'single_select':
          if (field.options?.length) values[key] = this.dice.pick(field.options).key;
          else if (field.optionsFrom === 'catalogue_products' && this.products.length > 0)
            values[key] = this.dice.pick(this.products);
          break;
        case 'multi_select':
          if (field.options?.length)
            values[key] = this.dice
              .shuffle(field.options)
              .slice(0, this.dice.int(1, Math.min(2, field.options.length)))
              .map((option) => option.key);
          break;
        case 'yes_no':
          values[key] = this.dice.chance(0.7);
          break;
        case 'rating':
          values[key] = this.dice.int(2, 5);
          break;
        case 'date': {
          const earliest = field.minDaysFromToday ?? 0;
          const latest = Math.max(earliest, field.maxDaysFromToday ?? earliest);
          values[key] = addDays(
            todayIn(this.timezone),
            this.dice.int(earliest, Math.min(latest, earliest + 30)),
          );
          break;
        }
        case 'product_lines': {
          // Required lists always, others now and then: a few items, as the person would pick.
          if (this.items.length === 0 || (!field.required && !this.dice.chance(0.5))) break;
          values[key] = this.dice
            .shuffle(this.items)
            .slice(0, this.dice.int(1, Math.min(3, field.maxLines, this.items.length)))
            .map((item) => ({
              itemId: item.id,
              quantity: field.quantities === false ? 1 : this.dice.int(1, 10),
              ...(field.valueColumn ? { value: String(this.dice.int(20, 400)) } : {}),
            }));
          break;
        }
        default:
          break;
      }
    }
    return values;
  }

  /** A signature, as a pad draws one: a loop and a flourish, never quite the same. */
  private signature() {
    const y = this.dice.int(60, 90);
    return {
      width: 320,
      height: 140,
      strokes: [
        `M20 ${y} C60 ${y - 50} 90 ${y + 40} 130 ${y - 10} C160 ${y - 40} 190 ${y + 20} 220 ${y}`,
        `M230 ${y - 5} L${this.dice.int(270, 300)} ${y + this.dice.int(-20, 20)}`,
      ],
    };
  }

  /** The managers review what came in, except the last two days', which wait. */
  private async review(team: FieldPerson[], date: string, today: string): Promise<void> {
    const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY;
    if (ageDays < 2) return;
    travelTo(this.at(date, 19 * 60 + 30));
    const managers = new Map(team.map((person) => [person.manager.id, person.manager]));
    for (const manager of managers.values()) {
      const queue = await this.tx((tx) =>
        this.get(ReviewService).queue(
          tx,
          manager.access,
          ReviewQueueQuery.parse({ status: 'pending', from: date, to: date, limit: 100 }),
        ),
      ).catch((error: unknown) => {
        this.once('review queue', error);
        return { items: [] };
      });
      for (const item of queue.items) {
        const reject = this.dice.chance(0.07);
        await this.tx((tx) =>
          this.get(ReviewService).decide(tx, manager.access, item.id, {
            decision: reject ? 'rejected' : 'approved',
            ...(reject ? { note: this.dice.pick(this.flavour.rejections) } : {}),
          }),
        )
          .then(() => this.counts.reviews++)
          .catch((error: unknown) => this.once('review', error));
      }
    }
  }

  /** What the nightly jobs do: missed plans, and everyone's attendance for the day. */
  private async endOfDay(date: string): Promise<void> {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
    travelTo(this.at(next, 30));
    await this.tx((tx) => this.get(PlanningService).missDayEnded(tx, this.tenantId, next)).catch(
      (error: unknown) => this.once('missed plans', error),
    );
    await this.tx((tx) =>
      this.get(AttendanceService).store(tx, this.tenantId, 'everyone', date),
    ).catch((error: unknown) => this.once('attendance', error));
  }
}
