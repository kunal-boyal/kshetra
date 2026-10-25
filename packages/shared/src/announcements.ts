/**
 * Announcements (module M22, decision D93): what the vendor tells tenants, in the portal and the
 * apps, for a window of time: to all of them or to some, as information or as a warning, such as
 * planned maintenance.
 */

export const ANNOUNCEMENT_TONES = ['info', 'warning'] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

export const ANNOUNCEMENT_SURFACES = ['web', 'mobile'] as const;
export type AnnouncementSurface = (typeof ANNOUNCEMENT_SURFACES)[number];

/** The longest an announcement may show. */
export const ANNOUNCEMENT_MAX_DAYS = 31;

export const ANNOUNCEMENT_STATUSES = ['scheduled', 'showing', 'ended', 'withdrawn'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** Where an announcement stands at a moment: waiting to start, showing, over, or withdrawn. */
export function announcementStatus(
  announcement: { startsAt: Date; endsAt: Date; withdrawnAt: Date | null },
  now: Date,
): AnnouncementStatus {
  if (announcement.withdrawnAt) return 'withdrawn';
  if (now < announcement.startsAt) return 'scheduled';
  return now < announcement.endsAt ? 'showing' : 'ended';
}

/** What is wrong with an announcement's window, or null: it ends after it starts, within a month. */
export function announcementWindowIssue(
  startsAt: Date,
  endsAt: Date,
): { path: string; issue: string } | null {
  if (endsAt <= startsAt) return { path: 'endsAt', issue: 'End after it starts' };
  if (endsAt.getTime() - startsAt.getTime() > ANNOUNCEMENT_MAX_DAYS * 86_400_000) {
    return { path: 'endsAt', issue: `Show it for ${ANNOUNCEMENT_MAX_DAYS} days at most` };
  }
  return null;
}
