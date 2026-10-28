import { radius, size, spacing } from '@thelamp/design-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { Icon } from './icon';
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
  /** Fixed text before the value, such as `+91`, inside the field. */
  prefix?: string;
  /** An icon inside the field, before the value, such as a magnifier on a search. */
  icon?: LucideIcon;
  /**
   * A search whose icon says what it is: the label names the field for screen readers and stands
   * as its placeholder, unless one is given, rather than showing above it.
   */
  labelHidden?: boolean;
}

/**
 * A labelled input with help or an error below it (components/TextField). The required mark is
 * part of the accessible name, and an error is announced as it appears.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    help,
    error,
    required = false,
    numeric = false,
    prefix,
    icon,
    labelHidden = false,
    onFocus,
    onBlur,
    ...input
  },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const note = error ?? help;
  const outdoor = theme.name === 'outdoor';
  return (
    <View style={styles.field}>
      {labelHidden ? null : (
        <Text variant="labelMd" aria-hidden>
          {label}
          {required ? (
            <Text variant="labelMd" tone="danger">
              {' *'}
            </Text>
          ) : null}
        </Text>
      )}
      <View>
        {prefix ? (
          <Text tone="muted" aria-hidden style={styles.prefix}>
            {prefix}
          </Text>
        ) : null}
        {icon ? (
          <View aria-hidden style={styles.icon}>
            <Icon icon={icon} size="sm" color={theme.colors.textMuted} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          aria-label={required ? `${label} *` : label}
          aria-invalid={error ? true : undefined}
          placeholderTextColor={theme.colors.textSubtle}
          placeholder={labelHidden ? label : undefined}
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
            prefix || icon ? styles.prefixed : null,
          ]}
          {...input}
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
  // The prefix sits inside the field, before the value, as the web's ks-affix does.
  prefix: {
    position: 'absolute',
    left: spacing.space4,
    top: 0,
    bottom: 0,
    zIndex: 1,
    textAlignVertical: 'center',
    lineHeight: size.controlLg,
  },
  icon: {
    position: 'absolute',
    left: spacing.space4,
    top: 0,
    bottom: 0,
    zIndex: 1,
    justifyContent: 'center',
  },
  prefixed: { paddingLeft: spacing.space12 },
});
