import { radius, spacing } from '@thelamp/design-tokens';
import { Button, Text, useTheme } from '@thelamp/ui-mobile';
import { Eraser } from 'lucide-react-native';
import { useState } from 'react';
import { type GestureResponderEvent, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useLanguage } from '../i18n';

const HEIGHT = 180;

const point = (event: GestureResponderEvent) =>
  `${Math.round(event.nativeEvent.locationX)} ${Math.round(event.nativeEvent.locationY)}`;

/**
 * A signature drawn with a finger (spec 8.1 Form): each stroke kept as SVG path data, so it reads
 * the same at any size and the server can render it to an image.
 */
export function SignaturePad({
  label,
  required,
  strokes,
  onChange,
  error,
  readOnly = false,
}: {
  label: string;
  required: boolean;
  strokes: readonly string[];
  onChange: (strokes: string[]) => void;
  error?: string;
  readOnly?: boolean;
}) {
  const { t } = useLanguage();
  const theme = useTheme();
  // The stroke being drawn, kept until the finger lifts.
  const [drawing, setDrawing] = useState<string | null>(null);
  const ink = theme.colors.text;
  return (
    <View style={styles.stack}>
      <Text variant="labelMd">
        {label}
        {required ? (
          <Text variant="labelMd" tone="danger">
            {' *'}
          </Text>
        ) : null}
      </Text>
      <View
        role="img"
        aria-label={strokes.length > 0 ? t('entry.signature_drawn') : t('entry.signature_empty')}
        style={[
          styles.pad,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.dangerSolid : theme.colors.borderStrong,
          },
        ]}
        onStartShouldSetResponder={() => !readOnly}
        onMoveShouldSetResponder={() => !readOnly}
        // The pad keeps the finger, so drawing never scrolls the screen.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => setDrawing(`M${point(event)}`)}
        onResponderMove={(event) => {
          const at = point(event);
          setDrawing((stroke) => (stroke === null ? null : `${stroke} L${at}`));
        }}
        onResponderRelease={() => {
          if (drawing) onChange([...strokes, drawing]);
          setDrawing(null);
        }}
        onResponderTerminate={() => setDrawing(null)}
      >
        <Svg width="100%" height={HEIGHT}>
          {[...strokes, ...(drawing ? [drawing] : [])].map((stroke, index) => (
            <Path
              key={index}
              d={stroke}
              stroke={ink}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      </View>
      {error ? (
        <Text variant="bodySm" tone="danger" role="alert">
          {error}
        </Text>
      ) : (
        <Text variant="bodySm" tone="muted">
          {t('entry.signature_help')}
        </Text>
      )}
      {!readOnly && strokes.length > 0 ? (
        <Button
          variant="ghost"
          icon={Eraser}
          label={t('entry.signature_clear')}
          onPress={() => onChange([])}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  pad: { height: HEIGHT, borderWidth: 1, borderRadius: radius.radiusMd, overflow: 'hidden' },
});
