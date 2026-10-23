import { radius, size, spacing } from '@thelamp/design-tokens';
import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { Text } from './text';
import { useTheme } from './theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Says what to enter; replaced by the error while there is one. */
  help?: string;
  /** Says how to fix the value: "Enter the 6-digit code", never "Invalid". */
  error?: string;
  required?: boolean;
  /** Right-aligned tabular figures, for amounts and counts. */
  numeric?: boolean;
}

/**
 * A labelled input with help or an error below it (components/TextField). The required mark is
 * part of the accessible name, and an error is announced as it appears.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, help, error, required = false, numeric = false, onFocus, onBlur, ...input },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const note = error ?? help;
  const outdoor = theme.name === 'outdoor';
  return (
    <View style={styles.field}>
      <Text variant="labelMd" aria-hidden>
        {label}
        {required ? (
          <Text variant="labelMd" tone="danger">
            {' *'}
          </Text>
        ) : null}
      </Text>
      <TextInput
        ref={ref}
        aria-label={required ? `${label} *` : label}
        aria-invalid={error ? true : undefined}
        placeholderTextColor={theme.colors.textSubtle}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          theme.text('bodyLg'),
          styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: error
              ? theme.colors.dangerSolid
              : focused
                ? theme.colors.accent
                : theme.colors.borderStrong,
            borderWidth: error || outdoor ? 2 : 1,
          },
          error ? { boxShadow: `0 0 0 4px ${theme.colors.dangerBg}` } : null,
          numeric && styles.numeric,
        ]}
        {...input}
      />
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
});

const styles = StyleSheet.create({
  field: { gap: spacing.space1 },
  input: {
    minHeight: size.controlLg,
    borderRadius: radius.radiusMd,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space2,
  },
  numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
});
