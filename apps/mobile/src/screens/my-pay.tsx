import { spacing } from '@thelamp/design-tokens';
import { formatMoney, formatMonth, formatNumber } from '@thelamp/i18n';
import { todayIn } from '@thelamp/shared';
import { Button, Card, ListGroup, ListRow, Notice, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, RotateCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useMyPayslip } from '../payroll';

/** The month before a `YYYY-MM` month. */
const monthBefore = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};

/**
 * My pay estimate (M14, decision D117): this month so far and last month, each from the person's
 * gross and attendance (BR-26), with the words that say it is an estimate, not payroll. Read online.
 */
export function MyPayScreen() {
  const { t } = useLanguage();
  const config = useConfig();
  const thisMonth = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata').slice(0, 7);
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/me'))}
      />
      <Text variant="headingXl" role="heading">
        {t('pay.title')}
      </Text>
      <Notice>{t('copy.provisional_pay')}</Notice>
      <Month period={thisMonth} />
      <Month period={monthBefore(thisMonth)} />
    </Screen>
  );
}

function Month({ period }: { period: string }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const slip = useMyPayslip(period);
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const count = (value: number) => formatNumber(value, { locale });
  const data = slip.data;
  return (
    <Card style={styles.stack}>
      <Text variant="headingMd" role="heading">
        {formatMonth(period, { locale })}
      </Text>
      {slip.isError ? (
        <View style={styles.stack}>
          <Text tone="danger" role="alert">
            {errorMessage(slip.error, t)}
          </Text>
          <Button
            variant="secondary"
            icon={RotateCw}
            label={t('common.retry')}
            onPress={() => void slip.refetch()}
          />
        </View>
      ) : !data ? (
        <Text tone="muted">{t('common.loading')}</Text>
      ) : (
        <>
          {data.amount === null ? (
            <Text tone="muted">{t('payslip.no_gross')}</Text>
          ) : (
            <Text variant="headingLg">
              {t(data.toDate ? 'payslip.estimate_so_far' : 'payslip.estimate', {
                amount: money(data.amount),
              })}
            </Text>
          )}
          <ListGroup>
            {data.monthlyGross !== null ? (
              <ListRow
                label={t('payslip.gross')}
                trailing={<Figure>{money(data.monthlyGross)}</Figure>}
              />
            ) : null}
            <ListRow
              label={t('payslip.paid_days')}
              trailing={
                <Figure>
                  {t('payroll.days_of', {
                    paid: count(data.paid),
                    scheduled: count(data.scheduled),
                  })}
                </Figure>
              }
            />
            <ListRow
              label={t('report.col_present_days')}
              trailing={<Figure>{count(data.days.present ?? 0)}</Figure>}
            />
            <ListRow
              label={t('report.col_half_days')}
              trailing={<Figure>{count(data.days.half_day ?? 0)}</Figure>}
            />
            <ListRow
              label={t('report.col_paid_leave_days')}
              trailing={<Figure>{count(data.days.paid_leave ?? 0)}</Figure>}
            />
            <ListRow
              label={t('report.col_unpaid_leave_days')}
              trailing={<Figure>{count(data.days.unpaid_leave ?? 0)}</Figure>}
            />
            <ListRow
              label={t('report.col_absent_days')}
              trailing={<Figure>{count(data.days.absent ?? 0)}</Figure>}
            />
          </ListGroup>
        </>
      )}
    </Card>
  );
}

/** A row's figure, on its right. */
function Figure({ children }: { children: string }) {
  return <Text weight={600}>{children}</Text>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
});
