import { BottomNav, useTheme } from '@kshetra/ui-mobile';
import { Tabs } from 'expo-router';
import { House, type LucideIcon, UserRound } from 'lucide-react-native';
import { type ComponentProps, useEffect } from 'react';
import { useConfig } from '../../data';
import { useLanguage } from '../../i18n';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Plan, Orders and Team join as their modules arrive, filtered by permissions (spec 8.1). */
const ICONS: Record<string, LucideIcon> = { index: House, me: UserRound };

/** The signed-in app: its tabs, in the tenant's own words once the config bundle is in. */
export default function AppLayout() {
  const { t, setTerms } = useLanguage();
  const theme = useTheme();
  const config = useConfig();

  useEffect(() => {
    setTerms(config.data?.bundle.terminology);
  }, [config.data, setTerms]);

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.colors.bg } }}
      tabBar={(props) => <Nav {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('app.home') }} />
      <Tabs.Screen name="me" options={{ title: t('app.me') }} />
    </Tabs>
  );
}

function Nav({ state, descriptors, navigation }: TabBarProps) {
  const { t } = useLanguage();
  return (
    <BottomNav
      label={t('shell.navigation')}
      items={state.routes.map((route, index) => ({
        key: route.key,
        label: descriptors[route.key]?.options.title ?? route.name,
        icon: ICONS[route.name] ?? House,
        active: state.index === index,
        onPress: () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
        },
      }))}
    />
  );
}
