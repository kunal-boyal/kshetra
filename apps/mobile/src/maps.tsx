import { radius, spacing } from '@thelamp/design-tokens';
import type { GeoPoint } from '@thelamp/shared';
import { type Colors, Text, useTheme } from '@thelamp/ui-mobile';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

/**
 * Maps on the phone (M17, decision D61), on react-native-maps: Google Maps on Android with the key
 * EAS supplies. Tiles need signal; whatever a map shows is also said in words beside it, so the
 * screen still works offline. The web target has its own stand-in (`maps.web.tsx`).
 */

/** A dot's colour: a status tone from the tokens. */
export type SpotTone = 'accent' | 'success' | 'pending' | 'danger' | 'neutral' | 'info';

const FILL: Record<SpotTone, keyof Colors> = {
  accent: 'accent',
  success: 'successSolid',
  pending: 'pendingSolid',
  danger: 'dangerSolid',
  neutral: 'textSubtle',
  info: 'infoSolid',
};

/** The colour of a tone in the current theme. */
export function useSpotColour(tone: SpotTone): string {
  return useTheme().colors[FILL[tone]];
}

/** Lighter than its colour, for areas: a hex colour with an alpha. */
const faint = (colour: string, alpha: string) =>
  /^#[0-9a-f]{6}$/i.test(colour) ? `${colour}${alpha}` : colour;

/** Where the camera goes for some points: one point close up, several fitted with a margin. */
function frameTo(map: MapView, fit: readonly GeoPoint[]) {
  if (fit.length === 0) return;
  if (fit.length === 1) {
    map.animateToRegion(
      {
        latitude: fit[0]!.lat,
        longitude: fit[0]!.lng,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      },
      0,
    );
    return;
  }
  const edge = spacing.space8;
  map.fitToCoordinates(
    fit.map((point) => ({ latitude: point.lat, longitude: point.lng })),
    { edgePadding: { top: edge, right: edge, bottom: edge, left: edge }, animated: false },
  );
}

/**
 * A map with a name for screen readers. It frames `fit` when ready, and again whenever `frame`
 * changes (by default, whenever the points do).
 */
export function PhoneMap({
  label,
  fit,
  frame,
  height = 220,
  children,
}: {
  label: string;
  fit: readonly GeoPoint[];
  frame?: string;
  height?: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const key = frame ?? fit.map((point) => `${point.lat},${point.lng}`).join(';');
  useEffect(() => {
    if (ready && map.current) frameTo(map.current, fit);
    // Only a new frame moves the camera; points moving on a refresh don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  return (
    <View
      style={[
        styles.frame,
        { height, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceSunken },
      ]}
    >
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        accessibilityLabel={label}
        {...(Platform.OS === 'android' ? { provider: PROVIDER_GOOGLE } : {})}
        userInterfaceStyle={theme.name === 'dark' ? 'dark' : 'light'}
        toolbarEnabled={false}
        showsMyLocationButton={false}
        onMapReady={() => setReady(true)}
      >
        {children}
      </MapView>
    </View>
  );
}

/**
 * A dot on the map in a token colour, with a title for its callout. A label, such as a stop's
 * number, sits inside it.
 */
export function Spot({
  at,
  title,
  tone = 'accent',
  label,
  onPress,
}: {
  at: GeoPoint;
  title: string;
  tone?: SpotTone;
  label?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const fill = useSpotColour(tone);
  // Android draws a custom marker once as a picture: track changes only until it has laid out.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(timer);
  }, [fill, label]);
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      title={title}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      {...(onPress ? { onCalloutPress: onPress } : {})}
    >
      <View
        style={[
          label ? styles.numbered : styles.dot,
          { backgroundColor: fill, borderColor: theme.colors.surface },
        ]}
      >
        {label ? (
          <Text variant="labelSm" style={{ color: theme.colors.textInverse }}>
            {label}
          </Text>
        ) : null}
      </View>
    </Marker>
  );
}

/** A circle of `metres` around a point, lightly filled in a tone's colour. */
export function Ring({
  at,
  metres,
  tone = 'accent',
}: {
  at: GeoPoint;
  metres: number;
  tone?: SpotTone;
}) {
  const colour = useSpotColour(tone);
  return (
    <Circle
      center={{ latitude: at.lat, longitude: at.lng }}
      radius={metres}
      strokeColor={colour}
      strokeWidth={1}
      fillColor={faint(colour, '29')}
    />
  );
}

/** A line through points in order, such as a route or a trail. */
export function Line({ path, tone = 'accent' }: { path: readonly GeoPoint[]; tone?: SpotTone }) {
  const colour = useSpotColour(tone);
  if (path.length < 2) return null;
  return (
    <Polyline
      coordinates={path.map((point) => ({ latitude: point.lat, longitude: point.lng }))}
      strokeColor={colour}
      strokeWidth={4}
    />
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.radiusLg, borderWidth: 1, overflow: 'hidden' },
  dot: {
    width: spacing.space4,
    height: spacing.space4,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
  },
  numbered: {
    minWidth: spacing.space6,
    height: spacing.space6,
    paddingHorizontal: spacing.space1,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
