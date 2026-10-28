import { spacing } from '@thelamp/design-tokens';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';

/**
 * A scrolling screen on the theme's ground, clear of the notch and the home indicator, that keeps
 * a focused field above the keyboard. Taps on buttons land while the keyboard is open.
 */
export function Screen({
  children,
  edges = ['top', 'left', 'right', 'bottom'],
  centred = false,
  bleed = false,
}: {
  children: ReactNode;
  /** Leave out `bottom` above a tab bar, which keeps clear of the home indicator itself. */
  edges?: Edge[];
  /** Centres short content, such as sign-in, in the space there is. */
  centred?: boolean;
  /** No padding or gaps, for a screen that draws its own, such as sign-in's band (D104). */
  bleed?: boolean;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[bleed ? styles.bleed : styles.content, centred && styles.centred]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.space4, gap: spacing.space6 },
  bleed: { flexGrow: 1 },
  centred: { flexGrow: 1, justifyContent: 'center' },
});
