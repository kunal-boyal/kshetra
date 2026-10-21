import { BottomNav, useTheme } from '@kshetra/ui-mobile';
import { Tabs } from 'expo-router';
import {
  ClipboardList,
  House,
  type LucideIcon,
  Store,
  UserRound,
  Users,
} from 'lucide-react-native';
import { type ComponentProps, useEffect } from 'react';
import { useConfig } from '../../../data';
import { useLanguage } from '../../../i18n';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Plan and Orders join as their modules arrive; Team is for those who review or watch the live map (spec 8.1). */
const ICONS: Record<string, LucideIcon> = {
  index: House,
  accounts: Store,
  forms: ClipboardList,
  team: Users,
  me: UserRound,
};

/** The tabs, in the tenant's own words once the config bundle is in. */
export default function TabsLayout() {
  const { t, setTerms } = useLanguage();
  const theme = useTheme();
  const config = useConfig();

  useEffect(() => {
    setTerms(config.data?.bundle.terminology);
  }, [config.data, setTerms]);
  const can = (permission: string) =>
    (config.data?.bundle.access.permissions ?? []).some((held) => held === permission);

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.colors.bg } }}
      tabBar={(props) => <Nav {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('app.home') }} />
      <Tabs.Screen
        name="accounts"
        options={{ title: t('accounts.title'), href: can('account.view') ? undefined : null }}
      />
      <Tabs.Screen
        name="forms"
        options={{ title: t('forms.title'), href: can('submission.create') ? undefined : null }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: t('team.title'),
          href: can('submission.review') || can('live_map.view') ? undefined : null,
        }}
      />
      <Tabs.Screen name="me" options={{ title: t('app.me') }} />
    </Tabs>
  );
}

function Nav({ state, descriptors, navigation }: TabBarProps) {
  const { t } = useLanguage();
  return (
    <BottomNav
      label={t('shell.navigation')}
      items={state.routes.flatMap((route, index) =>
        // A tab hidden with `href: null` is for people without its permission.
        (descriptors[route.key]?.options as { href?: unknown } | undefined)?.href === null
          ? []
          : [
              {
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
                  if (state.index !== index && !event.defaultPrevented)
                    navigation.navigate(route.name);
                },
              },
            ],
      )}
    />
  );
}
