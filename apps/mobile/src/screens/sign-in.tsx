import { ApiError } from '@kshetra/api-client';
import { spacing } from '@kshetra/design-tokens';
import { BrandMark, Button, ListGroup, ListRow, Screen, Text, TextField } from '@kshetra/ui-mobile';
import { ArrowLeft, Building2, Languages, LogIn, RotateCw, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useApp } from '../app-state';
import { errorMessage, useLanguage } from '../i18n';
import { saveTenants, type TenantChoice } from '../preferences';
import { PRODUCT_NAME } from '../product';

/** How long before a new code may be asked for; the server allows 3 every 10 minutes (M1). */
const RESEND_SECONDS = 30;

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'choose'; ticket: string; tenants: TenantChoice[] };

/**
 * Signing in on a phone (spec 8.1, module M1): the number on the phone keypad, then the code with
 * SMS autofill and a resend timer, then the tenant when the number belongs to several. Errors say
 * what happened: a wrong or expired code, a phone not linked to the person, or no network.
 */
export function SignInScreen() {
  const { client, sync } = useApp();
  const { t, locale, setLocale } = useLanguage();
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'VALIDATION'
          ? t('signin.phone_invalid')
          : errorMessage(caught, t),
      );
    } finally {
      setBusy(false);
    }
  }

  function sendCode() {
    void run(async () => {
      await client.requestCode(phone);
      setCode('');
      setWait(RESEND_SECONDS);
      setStep({ name: 'code', phone });
    });
  }

  function verify() {
    void run(async () => {
      const result = await client.verifyCode(phone, code);
      if (result.status === 'choose_tenant') {
        saveTenants(result.tenants);
        setStep({ name: 'choose', ticket: result.ticket, tenants: result.tenants });
        return;
      }
      saveTenants([]);
      sync();
    });
  }

  function choose(ticket: string, tenantId: string) {
    void run(async () => {
      await client.selectTenant(ticket, tenantId);
      sync();
    });
  }

  return (
    <Screen centred>
      <View style={styles.header}>
        <View style={styles.brand}>
          <BrandMark size={40} />
          <Text variant="headingMd">{PRODUCT_NAME}</Text>
        </View>
        <Button
          variant="ghost"
          icon={Languages}
          label={locale === 'hi' ? 'English' : 'हिन्दी'}
          onPress={() => setLocale(locale === 'hi' ? 'en' : 'hi')}
        />
      </View>

      {step.name === 'phone' ? (
        <View style={styles.form}>
          <Text variant="headingXl" role="heading">
            {t('signin.title')}
          </Text>
          <Text tone="muted">{t('signin.intro')}</Text>
          <TextField
            label={t('signin.phone_label')}
            help={t('signin.phone_help')}
            {...(error ? { error } : {})}
            required
            value={phone}
            onChangeText={setPhone}
            inputMode="tel"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => phone.trim() && sendCode()}
          />
          <Button
            variant="primary"
            block
            icon={Send}
            label={t('signin.send_code')}
            busy={busy}
            disabled={!phone.trim()}
            onPress={sendCode}
          />
        </View>
      ) : null}

      {step.name === 'code' ? (
        <View style={styles.form}>
          <Text variant="headingXl" role="heading">
            {t('signin.title')}
          </Text>
          <TextField
            label={t('signin.code_label')}
            help={t('signin.code_help', { phone: step.phone })}
            {...(error ? { error } : {})}
            required
            numeric
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => code.length === 6 && verify()}
          />
          <Button
            variant="primary"
            block
            icon={LogIn}
            label={t('signin.verify')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={verify}
          />
          <View style={styles.row}>
            <Button
              variant="ghost"
              icon={ArrowLeft}
              label={t('signin.other_number')}
              onPress={() => {
                setError(undefined);
                setStep({ name: 'phone' });
              }}
            />
            {wait > 0 ? (
              <Text variant="bodySm" tone="subtle" aria-live="polite">
                {t('signin.resend_in', { count: wait })}
              </Text>
            ) : (
              <Button
                variant="ghost"
                icon={RotateCw}
                label={t('signin.resend')}
                disabled={busy}
                onPress={sendCode}
              />
            )}
          </View>
        </View>
      ) : null}

      {step.name === 'choose' ? (
        <View style={styles.form}>
          <Text variant="headingXl" role="heading">
            {t('signin.choose_title')}
          </Text>
          <Text tone="muted">{t('signin.choose_intro')}</Text>
          {error ? (
            <Text tone="danger" weight={500} role="alert">
              {error}
            </Text>
          ) : null}
          <ListGroup>
            {step.tenants.map((tenant) => (
              <ListRow
                key={tenant.id}
                icon={Building2}
                label={tenant.name}
                onPress={() => {
                  if (!busy) choose(step.ticket, tenant.id);
                }}
              />
            ))}
          </ListGroup>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  form: { gap: spacing.space4 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space2,
  },
});
