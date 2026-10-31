import type { ApprovalResult, ApprovalStep } from '@thelamp/shared';
import { type Step, Steps } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useDates } from '../people/shared';

/**
 * A request's whole chain (components/ApprovalSteps): who asked, who acted and what they said,
 * who it waits for now, and what comes after. Each step says its state in words.
 */
export function ApprovalSteps({ item }: { item: ApprovalResult }) {
  const { t } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const open = item.status === 'pending';
  const names = (people: ApprovalStep['approvers']) =>
    people.length ? people.map((person) => person.name).join(', ') : t('approvals.nobody');

  function describe(step: ApprovalStep): { state: Step['state']; title: string; meta: string[] } {
    const when = step.actedAt ? [dates.dateTime(step.actedAt)] : [];
    const note = step.note ? [t('approvals.note', { note: step.note })] : [];
    switch (step.status) {
      case 'approved':
        return {
          state: 'done',
          title: step.onBehalfOf
            ? t('approvals.step_approved_for', {
                name: step.actedBy?.name ?? names(step.approvers),
                for: step.onBehalfOf.name,
              })
            : t('approvals.step_approved', {
                name: step.actedBy?.name ?? names(step.approvers),
              }),
          meta: [...note, ...when],
        };
      case 'rejected':
        return {
          state: 'rejected',
          title: step.onBehalfOf
            ? t('approvals.step_rejected_for', {
                name: step.actedBy?.name ?? names(step.approvers),
                for: step.onBehalfOf.name,
              })
            : t('approvals.step_rejected', {
                name: step.actedBy?.name ?? names(step.approvers),
              }),
          meta: [...note, ...when],
        };
      case 'skipped':
        return {
          state: 'todo',
          title: t('approvals.step_skipped'),
          meta: step.skipReason ? [t(`approvals.skip_${step.skipReason}`)] : [],
        };
      case 'pending':
        return open
          ? {
              state: 'current',
              title: t('approvals.step_pending', { names: names(step.approvers) }),
              meta: [
                ...(step.escalated ? [t('approvals.step_escalated')] : []),
                ...(step.fallback ? [t('approvals.step_fallback')] : []),
              ],
            }
          : {
              state: 'todo',
              title: names(step.approvers),
              meta: [t('approvals.step_not_reached')],
            };
      case 'waiting':
        return {
          state: 'todo',
          title: names(step.approvers),
          meta: [t('approvals.step_not_reached')],
        };
    }
  }

  return (
    <Steps
      label={t('approvals.chain')}
      steps={[
        {
          state: 'done',
          title: t('approvals.step_asked', { name: item.requester.name }),
          meta: dates.dateTime(item.createdAt),
        },
        ...item.steps.map((step): Step => {
          const { state, title, meta } = describe(step);
          return { state, title, ...(meta.length ? { meta: meta.join(' · ') } : {}) };
        }),
      ]}
    />
  );
}
