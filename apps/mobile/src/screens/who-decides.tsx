import { spacing } from '@thelamp/design-tokens';
import type { RequestType } from '@thelamp/shared';
import { Card, type Step, Steps, Text } from '@thelamp/ui-mobile';
import { StyleSheet } from 'react-native';
import { useApprovalPreview } from '../approvals';
import { useLanguage } from '../i18n';

/**
 * Who decides a request before it is sent (decision D104): the person asking, then each step that
 * would wait for someone, as the server would route it with these facts. Without a signal it
 * shows nothing; when nobody can approve yet it says so, and sending is still the server's call.
 */
export function WhoDecides({
  title,
  requestType,
  facts,
  asking,
}: {
  /** "Who decides", or "After you send it". */
  title: string;
  requestType: RequestType;
  facts: Readonly<Record<string, string | number | boolean>>;
  /** What the person asks, under "You ask". */
  asking?: string;
}) {
  const { t } = useLanguage();
  const preview = useApprovalPreview(requestType, facts).data;
  if (!preview) return null;
  const steps: Step[] = [
    { state: 'done', title: t('who.you_ask'), ...(asking ? { meta: asking } : {}) },
    ...preview.steps.map((step, index): Step => ({
      state: index === 0 ? 'current' : 'todo',
      title: step.approvers.map((person) => person.name).join(', '),
      ...(step.escalated
        ? { meta: t('who.escalated') }
        : step.fallback
          ? { meta: t('who.fallback') }
          : {}),
    })),
  ];
  return (
    <Card style={styles.card}>
      <Text variant="headingMd" role="heading">
        {title}
      </Text>
      {preview.blocked ? (
        <Text tone="muted">{t('who.blocked')}</Text>
      ) : (
        <Steps label={title} steps={steps} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.space3 } });
