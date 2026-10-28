import { BottomNav, useTheme } from '@thelamp/ui-mobile';
import { Tabs } from 'expo-router';
import {
  CalendarCheck,
  House,
  LayoutGrid,
  type LucideIcon,
  ShoppingCart,
  Users,
} from 'lucide-react-native';
import { type ComponentProps, useEffect } from 'react';
import { useConfig } from '../../../data';
import { useLanguage } from '../../../i18n';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The prototype's five tabs (decision D104): Home, Plan, Orders, Team and More. Plan is for those
 * who visit, Orders for those who take orders while the module is on, Team for those who review
 * or watch the live map (spec 8.1); accounts and forms are reached from Home and More.
 */
const ICONS: Record<string, LucideIcon> = {
  index: House,
  plan: CalendarCheck,
  orders: ShoppingCart,
  team: Users,
  me: LayoutGrid,
};

/** The tabs, in the tenant's own words once the config bundle is in. */
export default function TabsLayout() {
  const { t, setTerms } = useLanguage();
  const theme = useTheme();
  const config = useConfig();

  useEffect(() => {
    setTerms(config.data?.bundle.terminology);
  }, [config.data, setTerms]);
  const modulesOff = config.data?.bundle.settings.modulesOff ?? [];
  const can = (permission: string) =>
    (config.data?.bundle.access.permissions ?? []).some((held) => held === permission);

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.colors.bg } }}
      tabBar={(props) => <Nav {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('app.home') }} />
      <Tabs.Screen
        name="plan"
        options={{ title: t('plan.title'), href: can('visit.use') ? undefined : null }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orders.title'),
          href: can('order.create') && !modulesOff.includes('orders') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: t('team.title'),
          href:
            can('submission.review') ||
            can('live_map.view') ||
            can('approval.act') ||
            can('account.approve')
              ? undefined
              : null,
        }}
      />
      <Tabs.Screen name="me" options={{ title: t('app.more') }} />
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
                // tab-home, tab-accounts and so on, for the Maestro flows (decision D68).
                testID: `tab-${route.name === 'index' ? 'home' : route.name}`,
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
