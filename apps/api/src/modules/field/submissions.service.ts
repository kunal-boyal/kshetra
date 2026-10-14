import { Injectable } from '@nestjs/common';
import { checkFormValues, type FormDefinition, photosIn } from '@kshetra/forms';
import {
  AppError,
  type AttachedPhoto,
  clockSkewed,
  type CreateSubmissionBody,
  type ErrorDetail,
  evidenceIssues,
  geofenceResult,
  type GeofenceResult,
  issueAt,
  POINT_EARLY_MS,
  type ReviewQueueQuery,
  type SubmissionFlag,
  type SubmissionListQuery,
  type SubmissionListResult,
  type SubmissionResult,
  photoIssues,
  todayIn,
} from '@kshetra/shared';
import { and, asc, desc, eq, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { accounts } from '../../db/schema/accounts';
import { submissions } from '../../db/schema/field';
import { forms, formVersions } from '../../db/schema/forms';
import { users } from '../../db/schema/iam';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import { Database, type TenantTx } from '../../platform/database';
import { pointOf, pointSql } from '../../platform/geo';
import { Outbox } from '../../platform/outbox';
import { Queues } from '../../platform/queues';
import { AccountsService } from '../accounts/accounts.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import { FormsService } from '../forms/forms.service';
import { clockSkewSeconds } from '../iam/devices.service';
import { notFound, outOfScope } from '../iam/actor';
import { Scopes } from '../iam/scopes';
import { PhotosService } from '../media/photos.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';
import { refuseEvidence, refuseOutsideGeofence } from './evidence';
import { ShiftsService } from './shifts.service';
import { VisitsService } from './visits.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every ID-shaped string in some values, for looking up what they refer to in one go. */
function idsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string' && UUID.test(value)) found.add(value.toLowerCase());
  else if (Array.isArray(value)) for (const item of value) idsIn(item, found);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) idsIn(item, found);
  }
  return found;
}

const invalid = (issues: ErrorDetail[]) =>
  new AppError('VALIDATION', 'Check the highlighted fields.', issues);

/**
 * Submissions (M6): a form filled in the field, judged as it was captured (BR-32), linked to an
 * account the person may record at (BR-34) and to their visit there, inside the geofence where
 * the form or account type requires it (BR-33). A submission is immutable once received; what
 * reviewers should look at goes in its flags. The signature is drawn into an image afterwards.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
    private readonly queues: Queues,
    private readonly config: TenantConfigService,
    private readonly scopes: Scopes,
    private readonly forms: FormsService,
    private readonly accounts: AccountsService,
    private readonly catalogue: CatalogueService,
    private readonly photos: PhotosService,
    private readonly shifts: ShiftsService,
    private readonly visits: VisitsService,
  ) {}

  private select(tx: TenantTx) {
    return tx
      .select({
        id: submissions.id,
        userId: submissions.userId,
        userCode: users.code,
        userName: users.name,
        formKey: forms.key,
        formVersion: submissions.formVersion,
        definition: formVersions.definition,
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        visitId: submissions.visitId,
        shiftId: submissions.shiftId,
        capturedAt: submissions.capturedAt,
        receivedAt: submissions.receivedAt,
        location: pointOf(submissions.point),
        accuracy: submissions.accuracy,
        distanceM: submissions.distanceM,
        geofence: submissions.geofence,
        data: submissions.data,
        photoIds: submissions.photoIds,
        signatureMediaId: submissions.signatureMediaId,
        flags: submissions.flags,
        status: submissions.status,
        autoApproved: submissions.autoApproved,
        autoApproveAt: submissions.autoApproveAt,
        deviceId: submissions.deviceId,
      })
      .from(submissions)
      .innerJoin(
        users,
        and(eq(users.tenantId, submissions.tenantId), eq(users.id, submissions.userId)),
      )
      .innerJoin(
        forms,
        and(eq(forms.tenantId, submissions.tenantId), eq(forms.id, submissions.formId)),
      )
      .innerJoin(
        formVersions,
        and(
          eq(formVersions.tenantId, submissions.tenantId),
          eq(formVersions.formId, submissions.formId),
          eq(formVersions.version, submissions.formVersion),
        ),
      )
      .leftJoin(
        accounts,
        and(eq(accounts.tenantId, submissions.tenantId), eq(accounts.id, submissions.accountId)),
      );
  }

  private static result(row: Awaited<ReturnType<SubmissionsService['select']>>[number]) {
    return {
      id: row.id,
      user: { id: row.userId, code: row.userCode, name: row.userName },
      form: { key: row.formKey, version: row.formVersion, name: row.definition.name },
      account:
        row.accountId === null
          ? null
          : { id: row.accountId, code: row.accountCode!, name: row.accountName! },
      visitId: row.visitId,
      shiftId: row.shiftId,
      capturedAt: row.capturedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      location: row.location!,
      accuracy: row.accuracy,
      distanceM: row.distanceM,
      geofence: row.geofence,
      values: row.data,
      photos: row.photoIds,
      signatureMediaId: row.signatureMediaId,
      flags: row.flags,
      status: row.status,
      autoApproved: row.autoApproved,
    } satisfies SubmissionResult;
  }

  async view(tx: TenantTx, tenantId: string, id: string): Promise<SubmissionResult> {
    const [row] = await this.select(tx).where(
      and(eq(submissions.tenantId, tenantId), eq(submissions.id, id)),
    );
    if (!row) throw notFound();
    return SubmissionsService.result(row);
  }

  /** Receives a submission from the phone, checking everything the spec asks (M6). */
  async create(
    tx: TenantTx,
    access: Access,
    body: CreateSubmissionBody,
    deviceTime: string | undefined,
  ): Promise<SubmissionResult> {
    if (!access.deviceId) {
      throw new AppError('USE_MOBILE_APP', 'Forms are filled in the mobile app.');
    }
    const tenantId = access.tenantId;
    const now = Date.now();
    const settings = await this.config.settings(tx, tenantId);
    const form = await this.forms.forSubmission(tx, access, body.form.key, body.form.version);
    const definition = form.definition;
    const capturedAt = Date.parse(body.capturedAt);

    // BR-32: the fix, the moment and the shift.
    const shift = await this.shifts.at(tx, tenantId, access.userId, capturedAt);
    refuseEvidence(
      evidenceIssues(
        { capturedAt, fix: { ...body.fix, capturedAt: Date.parse(body.fix.capturedAt) } },
        shift,
        {
          userId: access.userId,
          now,
          maxShiftHours: settings.maxShiftHours,
          syncWindowHours: settings.syncWindowHours,
          offShiftAllowed: definition.shift === 'allowed_off_shift',
        },
      ),
    );
    const onShift =
      shift !== null &&
      capturedAt >= shift.startedAt - POINT_EARLY_MS &&
      (shift.endedAt === null || capturedAt <= shift.endedAt);

    // The visit and the account (M6, BR-34).
    const visit = body.visitId ? await this.visits.own(tx, access, body.visitId) : null;
    if (definition.visitSession && !visit) {
      throw invalid([issueAt(['visitId'], 'Check in at the place first')]);
    }
    if (
      visit &&
      (capturedAt < visit.checkInAt.getTime() - POINT_EARLY_MS ||
        (visit.checkOutAt !== null && capturedAt > visit.checkOutAt.getTime()))
    ) {
      throw invalid([issueAt(['capturedAt'], 'This was captured outside the visit')]);
    }
    const link = definition.accountLink;
    let accountId: string | null = null;
    if (link.mode === 'none') {
      if (body.accountId) throw invalid([issueAt(['accountId'], 'This form takes no account')]);
    } else {
      if (visit && body.accountId && body.accountId !== visit.accountId) {
        throw invalid([issueAt(['accountId'], 'Use the account of the visit')]);
      }
      accountId = body.accountId ?? visit?.accountId ?? null;
      if (!accountId && link.mode === 'required') {
        throw invalid([issueAt(['accountId'], 'Choose the account this is for')]);
      }
    }
    const account = accountId
      ? await this.accounts.forCapture(tx, access, accountId, body.fix.location)
      : null;
    let geofence: GeofenceResult | null = null;
    const flags = new Set<SubmissionFlag>();
    if (account && link.mode !== 'none') {
      if (account.status !== 'active') {
        throw invalid([issueAt(['accountId'], 'This account is not active')]);
      }
      if (!link.accountTypes.includes(account.type)) {
        throw invalid([issueAt(['accountId'], 'This form is not for this kind of account')]);
      }
      // BR-33, by the form's policy or else the account type's.
      const policy = definition.geofence === 'inherit' ? account.policy : definition.geofence;
      geofence = geofenceResult({
        distanceM: account.distanceM,
        radiusM: account.radiusM,
        accuracyM: body.fix.accuracy,
        accuracyCapM: account.accuracyCapM,
      });
      if (geofence === 'outside' && policy === 'required') {
        refuseOutsideGeofence(account.distanceM, account.radiusM);
      }
      if (geofence === 'outside' && policy === 'advisory') flags.add('outside_geofence');
    }

    // The values, checked against everything they refer to (spec 5.6).
    const values = await this.checkValues(tx, access, definition, body, accountId, capturedAt);

    // Photos (BR-32, spec 12.2 step 5) and the signature.
    const photoIds = await this.checkPhotos(tx, access, definition, body, values, flags);
    if (definition.signature === 'required' && !body.signature) {
      throw invalid([issueAt(['signature'], 'Ask for a signature')]);
    }
    if (definition.signature === 'none' && body.signature) {
      throw invalid([issueAt(['signature'], 'This form takes no signature')]);
    }
    if (clockSkewed(clockSkewSeconds(deviceTime, new Date(now)))) flags.add('clock_skew');

    const status = definition.review === 'none' ? 'approved' : 'pending';
    // M7: a form reviewed automatically waits the tenant's delay, if nothing needs a person now.
    const rules = await this.config.reviewRules(tx, tenantId);
    const autoApproveAt =
      definition.review === 'auto' &&
      rules.autoApproval &&
      flags.size === 0 &&
      geofence !== 'outside'
        ? new Date(now + rules.delayHours * 3_600_000)
        : null;
    await tx.insert(submissions).values({
      id: body.id,
      tenantId,
      userId: access.userId,
      shiftId: onShift ? shift.id : null,
      visitId: visit?.id ?? null,
      accountId: account?.id ?? null,
      formId: form.id,
      formVersion: body.form.version,
      deviceId: access.deviceId,
      capturedAt: new Date(capturedAt),
      point: pointSql(body.fix.location),
      accuracy: body.fix.accuracy,
      gpsAt: new Date(body.fix.capturedAt),
      mocked: body.fix.mocked,
      data: values,
      photoIds: body.photos,
      signatureStrokes: body.signature ?? null,
      distanceM: account?.distanceM == null ? null : Math.round(account.distanceM),
      geofence,
      flags: [...flags],
      status,
      autoApproveAt,
    });
    await this.photos.attach(tx, tenantId, photoIds, { type: 'submission', id: body.id });
    await this.audit.record(tx, tenantId, userActor(access), {
      action: 'submission.created',
      target: { type: 'submission', id: body.id },
      before: null,
      after: { form: body.form, accountId: account?.id ?? null, status, flags: [...flags] },
    });
    await this.outbox.publish(tx, tenantId, 'submission.created', body.id, {
      submissionId: body.id,
      userId: access.userId,
      formKey: body.form.key,
      accountId: account?.id ?? null,
      visitId: visit?.id ?? null,
      capturedAt: new Date(capturedAt).toISOString(),
      status,
    });
    if (body.signature) {
      this.database.afterCommit(tx, () =>
        this.queues.add(
          'media',
          'submission.signature',
          { tenantId, submissionId: body.id },
          { jobId: `submission.signature.${body.id}` },
        ),
      );
    }
    return this.view(tx, tenantId, body.id);
  }

  private async checkValues(
    tx: TenantTx,
    access: Access,
    definition: FormDefinition,
    body: CreateSubmissionBody,
    accountId: string | null,
    capturedAt: number,
  ) {
    const tenantId = access.tenantId;
    const ids = [...idsIn(body.values)];
    const types = await this.accounts.typesSeen(tx, access, ids);
    const known = await this.catalogue.known(tx, tenantId, ids);
    const contacts = accountId
      ? await this.accounts.activeContactIds(tx, tenantId, accountId)
      : new Set<string>();
    const { timezone } = await this.config.settings(tx, tenantId);
    const checked = checkFormValues(
      definition,
      body.values,
      {
        today: todayIn(timezone, new Date(capturedAt)),
        accountType: (id) => types.get(id.toLowerCase()) ?? null,
        contactAtAccount: (id) => contacts.has(id.toLowerCase()),
        activeItem: (id) => known.items.has(id.toLowerCase()),
        catalogueEntry: (source, id) =>
          (source === 'catalogue_items' ? known.items : known.products).has(id.toLowerCase()),
      },
      ['values'],
    );
    if (checked.issues.length > 0) throw invalid(checked.issues);
    return checked.values;
  }

  /**
   * The form's photos and its photo fields' (BR-32): as many as the form asks, each the caller's
   * own evidence photo, uploaded, held by no other record, taken within 5 minutes and 500 m, and
   * from the gallery only where allowed. Flags gallery and duplicate photos; returns every ID.
   */
  private async checkPhotos(
    tx: TenantTx,
    access: Access,
    definition: FormDefinition,
    body: CreateSubmissionBody,
    values: Record<string, unknown>,
    flags: Set<SubmissionFlag>,
  ): Promise<string[]> {
    const policy = definition.photos;
    const count = body.photos.length;
    if (!policy && count > 0) throw invalid([issueAt(['photos'], 'This form takes no photos')]);
    if (policy && count < policy.min) {
      throw new AppError('PHOTO_REQUIRED', `Take at least ${policy.min} photos.`, [
        issueAt(['photos'], `Take at least ${policy.min}`),
      ]);
    }
    if (policy && count > policy.max) {
      throw invalid([issueAt(['photos'], `Take at most ${policy.max}`)]);
    }
    const wanted = [
      ...body.photos.map((id, index) => ({
        id,
        path: ['photos', index] as (string | number)[],
        galleryAllowed: policy?.source === 'camera_and_gallery',
      })),
      ...photosIn(definition, values),
    ];
    const ids = wanted.map((photo) => photo.id);
    if (new Set(ids).size !== ids.length) {
      throw invalid([issueAt(['photos'], 'Each photo can be used once')]);
    }
    const rows = new Map(
      (await this.photos.forRecord(tx, access.tenantId, ids)).map((row) => [row.id, row]),
    );
    const issues: ErrorDetail[] = [];
    for (const photo of wanted) {
      const row = rows.get(photo.id);
      if (!row || row.kind !== 'evidence') {
        issues.push(issueAt(photo.path, 'Take this photo again'));
        continue;
      }
      if (row.status === 'pending') {
        throw new AppError('MEDIA_NOT_READY', 'A photo has not finished uploading.', [
          issueAt(photo.path, 'Still uploading'),
        ]);
      }
      if (row.status === 'rejected' || row.status === 'deleted') {
        issues.push(issueAt(photo.path, 'This photo could not be used. Take it again'));
        continue;
      }
      const attached: AttachedPhoto = {
        id: row.id,
        userId: row.userId,
        ownerId: row.ownerId,
        capturedAt: row.capturedAt?.getTime() ?? null,
        point: row.point,
        source: row.source,
      };
      for (const found of photoIssues(
        [attached],
        {
          id: body.id,
          userId: access.userId,
          capturedAt: Date.parse(body.capturedAt),
          point: body.fix.location,
        },
        { galleryAllowed: photo.galleryAllowed },
      )) {
        issues.push(issueAt(photo.path, found.issue));
      }
      if (row.source === 'gallery') flags.add('gallery_photo');
      if (row.duplicateOfId) flags.add('duplicate_photo');
    }
    if (issues.length > 0) throw invalid(issues);
    return ids;
  }

  /** A person's or an account's submissions, newest first, for those whose scope reaches them. */
  async list(
    tx: TenantTx,
    access: Access,
    query: SubmissionListQuery,
  ): Promise<SubmissionListResult> {
    const tenantId = access.tenantId;
    let whose: SQL;
    if (query.userId) {
      if (
        query.userId !== access.userId &&
        !(await this.scopes.reaches(tx, access, query.userId))
      ) {
        throw outOfScope();
      }
      whose = eq(submissions.userId, query.userId);
    } else {
      await this.accounts.find(tx, access, query.accountId!);
      whose = eq(submissions.accountId, query.accountId!);
    }
    const [cursorAt, cursorId] = query.cursor ? query.cursor.split('|') : [];
    const found = await this.select(tx)
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          whose,
          cursorAt && cursorId
            ? or(
                lt(submissions.capturedAt, new Date(cursorAt)),
                and(eq(submissions.capturedAt, new Date(cursorAt)), lt(submissions.id, cursorId)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(submissions.capturedAt), desc(submissions.id))
      .limit(query.limit + 1);
    const page = found.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => SubmissionsService.result(row)),
      nextCursor:
        found.length > query.limit && last ? `${last.capturedAt.toISOString()}|${last.id}` : null,
    };
  }

  // Review (M7): the review module reads and decides submissions through these.

  /**
   * The review queue (M7): submissions of the people the caller's scope reaches, never the
   * caller's own, by status and the filters asked for, newest first. Each row carries what the
   * review module adds to it: the device, where it was captured, and when auto-approval is due.
   */
  async reviewRows(tx: TenantTx, access: Access, query: ReviewQueueQuery, only?: string) {
    const tenantId = access.tenantId;
    const { timezone } = await this.config.settings(tx, tenantId);
    const day = sql`(${submissions.capturedAt} at time zone ${timezone})::date`;
    const [cursorAt, cursorId] = query.cursor ? query.cursor.split('|') : [];
    const found = await this.select(tx)
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          // One submission, whatever its status, or the queue for a status.
          only ? eq(submissions.id, only) : eq(submissions.status, query.status),
          ne(submissions.userId, access.userId),
          await this.scopes.users(tx, access),
          query.userId ? eq(submissions.userId, query.userId) : undefined,
          query.formKey ? eq(forms.key, query.formKey) : undefined,
          query.accountId ? eq(submissions.accountId, query.accountId) : undefined,
          query.from ? sql`${day} >= ${query.from}::date` : undefined,
          query.to ? sql`${day} <= ${query.to}::date` : undefined,
          query.flag ? sql`${query.flag} = any(${submissions.flags})` : undefined,
          query.geofence ? eq(submissions.geofence, query.geofence) : undefined,
          cursorAt && cursorId
            ? or(
                lt(submissions.capturedAt, new Date(cursorAt)),
                and(eq(submissions.capturedAt, new Date(cursorAt)), lt(submissions.id, cursorId)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(submissions.capturedAt), desc(submissions.id))
      .limit(query.limit + 1);
    const page = found.slice(0, query.limit);
    const last = page.at(-1);
    return {
      rows: page.map((row) => ({
        ...SubmissionsService.result(row),
        deviceId: row.deviceId,
        autoApproveAt: row.autoApproveAt,
      })),
      nextCursor:
        found.length > query.limit && last ? `${last.capturedAt.toISOString()}|${last.id}` : null,
    };
  }

  /**
   * A submission as a decision on it needs it, locked: another tenant's is not found, and one of
   * someone the caller's scope doesn't reach is out of scope.
   */
  async forDecision(tx: TenantTx, access: Access, id: string) {
    const [row] = await tx
      .select({
        id: submissions.id,
        userId: submissions.userId,
        status: submissions.status,
        flags: submissions.flags,
        geofence: submissions.geofence,
        deviceId: submissions.deviceId,
        formId: submissions.formId,
        accountId: submissions.accountId,
        visitId: submissions.visitId,
        capturedAt: submissions.capturedAt,
      })
      .from(submissions)
      .where(and(eq(submissions.tenantId, access.tenantId), eq(submissions.id, id)))
      .for('update');
    if (!row) throw notFound();
    if (row.userId !== access.userId && !(await this.scopes.reaches(tx, access, row.userId))) {
      throw outOfScope();
    }
    return { ...row, formKey: await this.formKey(tx, access.tenantId, row.formId) };
  }

  private async formKey(tx: TenantTx, tenantId: string, formId: string): Promise<string> {
    const [form] = await tx
      .select({ key: forms.key })
      .from(forms)
      .where(and(eq(forms.tenantId, tenantId), eq(forms.id, formId)));
    return form!.key;
  }

  /** Records a review's outcome on the submission; auto-approval waits no more either way. */
  async setStatus(
    tx: TenantTx,
    tenantId: string,
    id: string,
    status: 'approved' | 'rejected',
    auto: boolean,
  ): Promise<void> {
    await tx
      .update(submissions)
      .set({ status, autoApproved: auto, autoApproveAt: null })
      .where(and(eq(submissions.tenantId, tenantId), eq(submissions.id, id)));
  }

  /** Pending submissions whose auto-approval is due, locked, oldest first (M7). */
  async dueForAutoApproval(tx: TenantTx, tenantId: string, now: Date, limit = 500) {
    const rows = await tx
      .select({
        id: submissions.id,
        userId: submissions.userId,
        flags: submissions.flags,
        geofence: submissions.geofence,
        deviceId: submissions.deviceId,
        formId: submissions.formId,
        accountId: submissions.accountId,
        visitId: submissions.visitId,
        capturedAt: submissions.capturedAt,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          eq(submissions.status, 'pending'),
          sql`${submissions.autoApproveAt} is not null`,
          lte(submissions.autoApproveAt, now),
        ),
      )
      .orderBy(asc(submissions.autoApproveAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    const keys = new Map<string, string>();
    const found = [];
    for (const row of rows) {
      if (!keys.has(row.formId)) keys.set(row.formId, await this.formKey(tx, tenantId, row.formId));
      found.push({ ...row, formKey: keys.get(row.formId)! });
    }
    return found;
  }

  /** Stops a submission that can no longer be approved automatically from waiting for it. */
  async stopAutoApproval(tx: TenantTx, tenantId: string, id: string): Promise<void> {
    await tx
      .update(submissions)
      .set({ autoApproveAt: null })
      .where(and(eq(submissions.tenantId, tenantId), eq(submissions.id, id)));
  }

  // Work after the commit, on the worker.

  /** Draws a submission's signature into an image (M6). Running it again changes nothing. */
  async renderSignature(tenantId: string, id: string): Promise<void> {
    await this.database.forTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          userId: submissions.userId,
          strokes: submissions.signatureStrokes,
          mediaId: submissions.signatureMediaId,
          capturedAt: submissions.capturedAt,
        })
        .from(submissions)
        .where(and(eq(submissions.tenantId, tenantId), eq(submissions.id, id)))
        .for('update');
      if (!row?.strokes || row.mediaId) return;
      const mediaId = await this.photos.storeSignature(tx, tenantId, row.userId, row.strokes, {
        type: 'submission',
        id,
        at: row.capturedAt,
      });
      await tx
        .update(submissions)
        .set({ signatureMediaId: mediaId })
        .where(and(eq(submissions.tenantId, tenantId), eq(submissions.id, id)));
    });
  }

  /** A photo found to repeat another after its submission arrived flags the submission (BR-40). */
  async flagDuplicate(tx: TenantTx, tenantId: string, id: string): Promise<void> {
    await tx
      .update(submissions)
      .set({ flags: sql`array_append(${submissions.flags}, 'duplicate_photo')` })
      .where(
        and(
          eq(submissions.tenantId, tenantId),
          eq(submissions.id, id),
          sql`not ('duplicate_photo' = any(${submissions.flags}))`,
        ),
      );
  }
}
