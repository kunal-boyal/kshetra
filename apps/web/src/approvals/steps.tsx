import type { ApprovalResult, ApprovalStep } from '@thelamp/shared';
import { cn, Icon } from '@thelamp/ui-web';
import { Check, X } from 'lucide-react';
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

  function describe(step: ApprovalStep): { state: string; title: string; meta: string[] } {
    const when = step.actedAt ? [dates.dateTime(step.actedAt)] : [];
    const note = step.note ? [t('approvals.note', { note: step.note })] : [];
    switch (step.status) {
      case 'approved':
        return {
          state: 'done',
          title: t('approvals.step_approved', {
            name: step.actedBy?.name ?? names(step.approvers),
          }),
          meta: [...note, ...when],
        };
      case 'rejected':
        return {
          state: 'rejected',
          title: t('approvals.step_rejected', {
            name: step.actedBy?.name ?? names(step.approvers),
          }),
          meta: [...note, ...when],
        };
      case 'skipped':
        return {
          state: '',
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
          : { state: '', title: names(step.approvers), meta: [t('approvals.step_not_reached')] };
      case 'waiting':
        return { state: '', title: names(step.approvers), meta: [t('approvals.step_not_reached')] };
    }
  }

  return (
    <ol className="ks-steps" aria-label={t('approvals.chain')}>
      <li className="ks-step done">
        <span className="ks-node">
          <Icon icon={Check} size="sm" />
        </span>
        <div>
          <p className="ks-title">{t('approvals.step_asked', { name: item.requester.name })}</p>
          <p className="ks-meta">{dates.dateTime(item.createdAt)}</p>
        </div>
      </li>
      {item.steps.map((step) => {
        const { state, title, meta } = describe(step);
        return (
          <li key={step.index} className={cn('ks-step', state)}>
            <span className="ks-node">
              {state === 'done' ? <Icon icon={Check} size="sm" /> : null}
              {state === 'rejected' ? <Icon icon={X} size="sm" /> : null}
            </span>
            <div>
              <p className={cn('ks-title', state ? '' : 'ks-muted')}>{title}</p>
              {meta.length ? <p className="ks-meta">{meta.join(' · ')}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
