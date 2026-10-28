import { ApiError } from '@thelamp/api-client';
import { radius, size, spacing } from '@thelamp/design-tokens';
import { mobileMessage } from '@thelamp/i18n';
import { maskPhone, mobileDigitsFrom } from '@thelamp/shared';
import {
  BrandMark,
  Button,
  Icon,
  Notice,
  OtpInput,
  Screen,
  Text,
  TextField,
  useTheme,
} from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, FileLock2, Languages, Lock, LogIn, RotateCw, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../app-state';
import { errorMessage, useLanguage } from '../i18n';
import { PRODUCT_NAME } from '../product';

/** How long before a new code may be asked for; the server allows 3 every 10 minutes (M1). */
const RESEND_SECONDS = 30;

type Step = { name: 'phone' } | { name: 'code'; phone: string };

/**
 * Signing in on a phone (spec 8.1, module M1): the number on the phone keypad, then the code with
 * SMS autofill and a resend timer; a number belongs to one organisation, so the code signs straight
 * in (decision D103). Errors say what happened: a wrong or expired code, a phone not linked to the
 * person, or no network. The look is the prototype's AppSignIn, under a Forest band (D104).
 */
export function SignInScreen() {
  const { client, sync } = useApp();
  const { t, locale, setLocale } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
    // A number that can't be one is explained here, before anything is sent (decision D102).
    const issue = mobileMessage(phone);
    if (issue) {
      setError(t(issue));
      return;
    }
    void run(async () => {
      await client.requestCode(phone);
      setCode('');
      setWait(RESEND_SECONDS);
      setStep({ name: 'code', phone });
    });
  }

  function verify() {
    void run(async () => {
      await client.verifyCode(phone, code);
      sync();
    });
  }

  return (
    <Screen edges={['left', 'right', 'bottom']} bleed>
      <View
        style={[
          styles.band,
          { backgroundColor: theme.colors.brandForest, paddingTop: insets.top + spacing.space6 },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <BrandMark size={36} />
            <Text variant="headingMd" style={{ color: theme.colors.onBrand }}>
              {PRODUCT_NAME}
            </Text>
          </View>
          <Pressable
            role="button"
            aria-label={locale === 'hi' ? 'English' : 'हिन्दी'}
            onPress={() => setLocale(locale === 'hi' ? 'en' : 'hi')}
            style={({ pressed }) => [
              styles.language,
              { borderColor: theme.colors.onBrand },
              pressed && styles.pressed,
            ]}
          >
            <Icon icon={Languages} size="sm" color={theme.colors.onBrand} />
            <Text variant="labelMd" weight={600} style={{ color: theme.colors.onBrand }}>
              {locale === 'hi' ? 'English' : 'हिन्दी'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.welcome}>
          <Text variant="display" role="heading" style={{ color: theme.colors.onBrand }}>
            {t('signin.band_title')}
          </Text>
          <Text style={[styles.soft, { color: theme.colors.onBrand }]}>
            {t('signin.band_intro')}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        {step.name === 'phone' ? (
          <View style={styles.form}>
            <TextField
              label={t('signin.phone_label')}
              help={t('signin.phone_help')}
              {...(error ? { error } : {})}
              required
              prefix="+91"
              value={phone}
              onChangeText={(typed) => setPhone(mobileDigitsFrom(typed))}
              inputMode="numeric"
              keyboardType="number-pad"
              autoComplete="tel-national"
              textContentType="telephoneNumber"
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => phone && sendCode()}
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
            <OtpInput
              label={t('signin.code_sent', { phone: maskPhone(`+91${step.phone}`) })}
              help={t('signin.code_autofill')}
              {...(error ? { error } : {})}
              value={code}
              onChange={setCode}
              autoFocus
              onSubmit={verify}
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
                size="sm"
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
                  size="sm"
                  icon={RotateCw}
                  label={t('signin.resend')}
                  disabled={busy}
                  onPress={sendCode}
                />
              )}
            </View>
          </View>
        ) : null}
        <Notice icon={Lock}>{t('signin.work_phone')}</Notice>
        {/* The privacy notice is readable before signing in (decision D100). */}
        <Button
          variant="ghost"
          size="sm"
          icon={FileLock2}
          label={t('privacy.open')}
          onPress={() => router.push('/privacy')}
        />
        <Text variant="bodySm" tone="muted" style={styles.footnote}>
          {t('signin.on_duty_only')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: spacing.space6,
    paddingBottom: spacing.space8,
    gap: spacing.space6,
    borderBottomLeftRadius: radius.radiusXl,
    borderBottomRightRadius: radius.radiusXl,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  language: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
    minHeight: size.touchMin,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
  },
  pressed: { opacity: 0.8 },
  welcome: { gap: spacing.space2 },
  soft: { opacity: 0.86 },
  body: { padding: spacing.space6, gap: spacing.space5 },
  footnote: { textAlign: 'center' },
  form: { gap: spacing.space4 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space2,
  },
});
