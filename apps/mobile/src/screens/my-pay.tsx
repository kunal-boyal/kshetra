import { spacing } from '@thelamp/design-tokens';
import {
  amountInWords,
  formatMoney,
  formatMonth,
  formatNumber,
  PAYSLIP_LINE_WORDS,
} from '@thelamp/i18n';
import { type StatutoryPayslip, todayIn } from '@thelamp/shared';
import { Button, Card, ListGroup, ListRow, Notice, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCw, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useConfig } from '../data';
import { errorMessage, useLanguage } from '../i18n';
import { useMyPayslip, useMyStatutoryPayslip } from '../payroll';

/** The month `step` months after a `YYYY-MM` month (before, when negative). */
const monthAfter = (period: string, step: number) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7);
};
const monthBefore = (period: string) => monthAfter(period, -1);

/**
 * My pay estimate (M14, decision D117): this month so far and last month, each from the person's
 * gross and attendance (BR-26), with the words that say it is an estimate, not payroll. Read online.
 */
export function MyPayScreen() {
  const { t } = useLanguage();
  const config = useConfig();
  const thisMonth = todayIn(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata').slice(0, 7);
  // With statutory payroll on, the person's payslip is the statutory one (decision D128).
  if (!(config.data?.bundle.settings.modulesOff ?? []).includes('statutory_payroll')) {
    return <MyPayslips thisMonth={thisMonth} />;
  }
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

/**
 * My payslips (decision D128): the person's approved statutory payslips a month at a time, from
 * last month back, each with its lines, net pay in figures and words, and the review label until a
 * chartered accountant has reviewed the rules and rates. Read online.
 */
function MyPayslips({ thisMonth }: { thisMonth: string }) {
  const { t, locale } = useLanguage();
  const [period, setPeriod] = useState(() => monthBefore(thisMonth));
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/me'))}
      />
      <Text variant="headingXl" role="heading">
        {t('pay.statutory_title')}
      </Text>
      <View style={styles.row}>
        <Button
          variant="secondary"
          icon={ChevronLeft}
          label={t('pay.previous_month')}
          onPress={() => setPeriod((shown) => monthAfter(shown, -1))}
        />
        <Button
          variant="secondary"
          icon={ChevronRight}
          label={t('pay.next_month')}
          disabled={period >= thisMonth}
          onPress={() => setPeriod((shown) => monthAfter(shown, 1))}
        />
      </View>
      <Text variant="headingMd" role="heading">
        {t('payslip.statutory_title', { month: formatMonth(period, { locale }) })}
      </Text>
      <Payslip period={period} />
    </Screen>
  );
}

function Payslip({ period }: { period: string }) {
  const { t, locale } = useLanguage();
  const slip = useMyStatutoryPayslip(period);
  if (slip.isError) {
    return (
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
    );
  }
  if (slip.data === undefined) return <Text tone="muted">{t('common.loading')}</Text>;
  if (slip.data === null) {
    return (
      <Text tone="muted">
        {t('pay.statutory_none', { month: formatMonth(period, { locale }) })}
      </Text>
    );
  }
  return <Lines slip={slip.data} />;
}

function Lines({ slip }: { slip: StatutoryPayslip }) {
  const { t, locale } = useLanguage();
  const config = useConfig();
  const currency = config.data?.bundle.settings.currency ?? 'INR';
  const money = (amount: string) => formatMoney(amount as `${number}`, { locale, currency });
  const count = (value: number) => formatNumber(value, { locale });
  const word = (key: string) =>
    PAYSLIP_LINE_WORDS[key] ? t(PAYSLIP_LINE_WORDS[key]) : key.replaceAll('_', ' ');
  const group = (title: string, lines: StatutoryPayslip['earnings'], total: string) => (
    <Card style={styles.stack}>
      <Text variant="headingMd" role="heading">
        {title}
      </Text>
      <ListGroup>
        {lines.map((line) => (
          <ListRow
            key={line.key}
            label={word(line.key)}
            trailing={<Figure>{money(line.amount)}</Figure>}
          />
        ))}
        <ListRow label={t('payslip.total')} trailing={<Figure>{money(total)}</Figure>} />
      </ListGroup>
    </Card>
  );
  return (
    <View style={styles.stack}>
      {slip.reviewed ? null : (
        <Notice tone="pending" icon={TriangleAlert}>
          {t('payroll.awaiting_review')}
        </Notice>
      )}
      <Card style={styles.stack}>
        <Text variant="headingLg">{t('payslip.net', { amount: money(slip.net) })}</Text>
        <Text>{t('payslip.net_words', { words: amountInWords(slip.net, locale) })}</Text>
        <ListGroup>
          <ListRow
            label={t('payslip.paid_days')}
            trailing={
              <Figure>
                {t('payroll.days_of', { paid: count(slip.paid), scheduled: count(slip.scheduled) })}
              </Figure>
            }
          />
          {slip.profile.uan ? (
            <ListRow label={t('payslip.uan')} trailing={<Figure>{slip.profile.uan}</Figure>} />
          ) : null}
          {slip.profile.esiNumber ? (
            <ListRow
              label={t('payslip.esi_number')}
              trailing={<Figure>{slip.profile.esiNumber}</Figure>}
            />
          ) : null}
        </ListGroup>
      </Card>
      {group(t('payslip.earnings'), slip.earnings, slip.gross)}
      {group(t('payslip.deductions'), slip.deductions, slip.totalDeductions)}
    </View>
  );
}

/** A row's figure, on its right. */
function Figure({ children }: { children: string }) {
  return <Text weight={600}>{children}</Text>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3 },
});
