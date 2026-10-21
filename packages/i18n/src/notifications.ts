import type { Locale, NotificationEventKey } from '@kshetra/shared';
import type { MessageKey } from './messages/en';

/**
 * What a notification says (M16, decision D58): its title and body keys and their values, from the
 * event and the values stored with it. The server renders push, SMS and email with it; the apps
 * render the inbox with it, so a notification reads the same everywhere, in the reader's language.
 * A stored value named `<name>_<locale>`, such as a form's name, gives `{name}` in that language.
 */
export function notificationMessage(
  event: NotificationEventKey,
  values: Readonly<Record<string, string | number>>,
  locale: Locale,
): { title: MessageKey; body: MessageKey; params: Record<string, string | number> } {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values)) {
    const localised = /^(.+)_(en|hi)$/.exec(name);
    if (!localised) {
      params[name] ??= value;
    } else if (localised[2] === locale) {
      params[localised[1]!] = value;
    } else {
      params[localised[1]!] ??= value;
    }
  }
  switch (event) {
    case 'approval.decided':
      return values.outcome === 'approved'
        ? { title: 'notify.approval_approved_title', body: 'notify.approval_approved_body', params }
        : {
            title: 'notify.approval_rejected_title',
            body: 'notify.approval_rejected_body',
            params,
          };
    case 'import.finished':
      return values.status === 'committed'
        ? { title: 'notify.import_committed_title', body: 'notify.import_committed_body', params }
        : { title: 'notify.import_failed_title', body: 'notify.import_failed_body', params };
    case 'export.finished':
      return values.status === 'ready'
        ? { title: 'notify.export_ready_title', body: 'notify.export_ready_body', params }
        : { title: 'notify.export_failed_title', body: 'notify.export_failed_body', params };
    case 'plan.today':
      return { title: 'notify.plan_today_title', body: 'notify.plan_today_body', params };
    case 'approval.waiting':
      return {
        title: 'notify.approval_waiting_title',
        body: 'notify.approval_waiting_body',
        params,
      };
    case 'submission.rejected':
      return {
        title: 'notify.submission_rejected_title',
        body: 'notify.submission_rejected_body',
        params,
      };
    case 'target.locked':
      return { title: 'notify.target_locked_title', body: 'notify.target_locked_body', params };
    case 'tracking.stopped':
      return {
        title: 'notify.tracking_stopped_title',
        body: 'notify.tracking_stopped_body',
        params,
      };
    case 'tracking.stopped_report':
      return {
        title: 'notify.tracking_report_title',
        body: 'notify.tracking_report_body',
        params,
      };
  }
}
