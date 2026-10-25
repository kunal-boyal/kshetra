import { z } from 'zod';
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_SURFACES,
  ANNOUNCEMENT_TONES,
  announcementWindowIssue,
} from '../announcements';
import { localizedText } from './config';

/** Announcements (module M22, decision D93), as the console writes them and tenants read them. */

export const AnnouncementTone = z.enum(ANNOUNCEMENT_TONES);
export const AnnouncementSurface = z.enum(ANNOUNCEMENT_SURFACES);

/** `POST /platform/v1/announcements`: made once under the console's own ID. */
export const AnnouncementBody = z
  .strictObject({
    id: z.uuid(),
    title: localizedText(80),
    body: localizedText(500),
    tone: AnnouncementTone,
    surfaces: z
      .array(AnnouncementSurface)
      .min(1)
      .refine((surfaces) => new Set(surfaces).size === surfaces.length, 'List each place once'),
    /** The tenants who see it; null for every tenant. */
    tenantIds: z.array(z.uuid()).min(1).max(200).nullable(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((body, context) => {
    const issue = announcementWindowIssue(new Date(body.startsAt), new Date(body.endsAt));
    if (issue) context.addIssue({ code: 'custom', path: [issue.path], message: issue.issue });
  })
  .meta({ id: 'AnnouncementBody' });

export const ConsoleAnnouncement = z
  .object({
    id: z.uuid(),
    title: localizedText(80),
    body: localizedText(500),
    tone: AnnouncementTone,
    surfaces: z.array(AnnouncementSurface),
    /** Who sees it; null for every tenant. */
    tenants: z.array(z.object({ id: z.uuid(), name: z.string() })).nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    status: z.enum(ANNOUNCEMENT_STATUSES),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ConsoleAnnouncement' });

export const ConsoleAnnouncementList = z.object({ items: z.array(ConsoleAnnouncement) });

/** `GET /v1/announcements`: what shows now, where the caller is. */
export const AnnouncementQuery = z.strictObject({ surface: AnnouncementSurface });

export const TenantAnnouncement = z
  .object({
    id: z.uuid(),
    title: localizedText(80),
    body: localizedText(500),
    tone: AnnouncementTone,
    endsAt: z.iso.datetime(),
  })
  .meta({ id: 'Announcement' });

export const TenantAnnouncementList = z.object({ items: z.array(TenantAnnouncement) });

export type AnnouncementBody = z.output<typeof AnnouncementBody>;
export type ConsoleAnnouncement = z.infer<typeof ConsoleAnnouncement>;
export type TenantAnnouncement = z.infer<typeof TenantAnnouncement>;
