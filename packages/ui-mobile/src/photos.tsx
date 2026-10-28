import { radius, spacing } from '@thelamp/design-tokens';
import { Camera, ImageOff } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

const SIDE = 64;

export interface Photo {
  /** Where the picture is, on the phone or behind a signed link; none while it is on its way. */
  uri?: string;
  /** When it was taken, as a tag on the picture, such as "10:42". */
  time?: string;
  /** What it shows, for screen readers, such as "Shop front, 10:42". */
  label: string;
}

/**
 * One photo as a 64 px tile (`ks-photo`), with the time it was taken on a tag. Without a picture
 * yet it shows a placeholder, never a broken image.
 */
export function PhotoTile({ uri, time, label, onPress }: Photo & { onPress?: () => void }) {
  const theme = useTheme();
  const outdoor = theme.name === 'outdoor';
  const tile = (
    <View
      accessible
      role="img"
      aria-label={label}
      style={[
        styles.tile,
        { backgroundColor: theme.colors.surfaceSunken },
        outdoor && { borderWidth: 1, borderColor: theme.colors.border },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Icon icon={ImageOff} color={theme.colors.textSubtle} />
      )}
      {time ? (
        <View
          style={[
            styles.tag,
            { backgroundColor: theme.colors.waitingBg },
            outdoor && { borderWidth: 1, borderColor: theme.colors.waitingFg },
          ]}
        >
          <Text variant="caption" style={{ color: theme.colors.waitingFg }} numberOfLines={1}>
            {time}
          </Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return tile;
  return (
    <Pressable role="button" aria-label={label} onPress={onPress}>
      {tile}
    </Pressable>
  );
}

/**
 * A capture's photos in a row that scrolls sideways, with a dashed tile at its end that takes
 * another while more are allowed.
 */
export function PhotoStrip({
  photos,
  label,
  onAdd,
  addLabel,
}: {
  photos: readonly Photo[];
  label: string;
  /** Leave out when no more may be taken. */
  onAdd?: () => void;
  addLabel: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      aria-label={label}
      contentContainerStyle={styles.strip}
    >
      {photos.map((photo, index) => (
        <PhotoTile key={photo.uri ?? index} {...photo} />
      ))}
      {onAdd ? (
        <Pressable
          role="button"
          aria-label={addLabel}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.tile,
            styles.add,
            {
              borderColor: theme.colors.borderStrong,
              backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            },
          ]}
        >
          <Icon icon={Camera} color={theme.colors.accentSubtleFg} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.space2 },
  tile: {
    width: SIDE,
    height: SIDE,
    borderRadius: radius.radiusMd,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: { borderWidth: 2, borderStyle: 'dashed' },
  tag: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    borderRadius: radius.radiusFull,
    alignItems: 'center',
  },
});
