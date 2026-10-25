import { radius, spacing } from '@thelamp/design-tokens';
import { Button, Icon, Text, useTheme } from '@thelamp/ui-mobile';
import { Info, TriangleAlert, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useAnnouncements } from '../announcements';
import { useLanguage } from '../i18n';

/**
 * What the vendor is announcing (decision D93), at the top of Home: a warning in amber,
 * information in blue, each until it ends or is dismissed on this phone.
 */
export function Announcements() {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const { items, dismiss } = useAnnouncements();
  if (items.length === 0) return null;
  return (
    <View style={styles.stack} role="region" aria-label={t('announce.title')}>
      {items.map((item) => {
        const tone = item.tone === 'warning' ? 'pending' : 'info';
        const ink = theme.colors[`${tone}Fg`];
        return (
          <View
            key={item.id}
            style={[
              styles.card,
              {
                backgroundColor: theme.colors[`${tone}Bg`],
                borderColor: theme.colors[`${tone}Border`],
              },
            ]}
          >
            <Icon icon={item.tone === 'warning' ? TriangleAlert : Info} color={ink} />
            <View style={styles.text}>
              <Text weight={600} style={{ color: ink }}>
                {item.title[locale]}
              </Text>
              <Text variant="bodySm" style={{ color: ink }}>
                {item.body[locale]}
              </Text>
            </View>
            <Button
              variant="ghost"
              icon={X}
              label={t('announce.dismiss_named', { title: item.title[locale] })}
              onPress={() => dismiss(item.id)}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.space2 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.space3,
    padding: spacing.space3,
    borderWidth: 1,
    borderRadius: radius.radiusLg,
  },
  text: { flex: 1, gap: spacing.space1 },
});
