import { radius, size, spacing } from '@thelamp/design-tokens';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Text } from './text';
import { useTheme } from './theme';

/**
 * A one-time code as six boxes (components/TextField): one input underneath takes the digits, so
 * the SMS fills it by itself and screen readers and tests meet a single field named by its label.
 * The box the next digit goes in is ringed in the accent; an error rings them all.
 */
export function OtpInput({
  label,
  value,
  onChange,
  error,
  help,
  length = 6,
  autoFocus = false,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  error?: string;
  help?: string;
  length?: number;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const outdoor = theme.name === 'outdoor';
  const note = error ?? help;
  return (
    <View style={styles.field}>
      <Text variant="labelMd" aria-hidden>
        {label}
      </Text>
      <View>
        <View aria-hidden style={styles.boxes}>
          {Array.from({ length }, (_, index) => {
            const next = focused && index === Math.min(value.length, length - 1);
            return (
              <View
                key={index}
                style={[
                  styles.box,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: error
                      ? theme.colors.dangerSolid
                      : next
                        ? theme.colors.accent
                        : theme.colors.borderStrong,
                    borderWidth: error || next || outdoor ? 2 : 1,
                  },
                  next && !error ? { boxShadow: `0 0 0 3px ${theme.colors.accentSubtle}` } : null,
                ]}
              >
                <Text variant="headingMd" style={styles.digit}>
                  {value[index] ?? ''}
                </Text>
              </View>
            );
          })}
        </View>
        <TextInput
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={value}
          onChangeText={(typed) => onChange(typed.replace(/\D/g, '').slice(0, length))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => value.length === length && onSubmit?.()}
          inputMode="numeric"
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={length}
          autoFocus={autoFocus}
          returnKeyType="done"
          caretHidden
          style={styles.hidden}
        />
      </View>
      {note ? (
        <Text
          variant="bodySm"
          tone={error ? 'danger' : 'muted'}
          weight={error ? 500 : undefined}
          role={error ? 'alert' : undefined}
          aria-live={error ? 'polite' : undefined}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.space1 },
  boxes: { flexDirection: 'row', gap: spacing.space2 },
  box: {
    flex: 1,
    minHeight: size.controlLg + spacing.space2,
    borderRadius: radius.radiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontVariant: ['tabular-nums'] },
  // Over the boxes and all but invisible: a tap on any box reaches it, and the SMS fills it.
  hidden: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.02,
    color: 'transparent',
  },
});
