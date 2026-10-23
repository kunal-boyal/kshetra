import { Button, EmptyState, ListGroup, ListRow, Screen, Text } from '@thelamp/ui-mobile';
import { router } from 'expo-router';
import { ArrowLeft, MapPinOff, Route } from 'lucide-react-native';
import { useLanguage } from '../i18n';
import { useLocalRows } from '../local-data';
import { useFix } from '../location';
import { Line, PhoneMap, Spot, type SpotTone } from '../maps';
import { useTodayPlan } from './today-plan';

const TONE: Record<string, SpotTone> = {
  planned: 'accent',
  visited: 'pending',
  completed: 'success',
  missed: 'danger',
};

/**
 * Today's route (spec 8.1, M8): the day's planned visits as numbered stops in plan order, a line
 * through those with a known place, and where the phone is. The list below says the same, so the
 * screen works without signal for the map.
 */
export function TodayRouteScreen() {
  const { t } = useLanguage();
  const accounts = useLocalRows('accounts') ?? [];
  const { items } = useTodayPlan();
  const fix = useFix();
  const stops = items.map((item, index) => {
    const account = accounts.find((entry) => entry.id === item.accountId);
    return {
      item,
      number: String(index + 1),
      name: account?.name ?? '—',
      at: account?.location ?? null,
    };
  });
  const placed = stops.flatMap((stop) => (stop.at ? [{ ...stop, at: stop.at }] : []));
  const me = fix.status === 'ready' ? fix.fix : null;
  const open = (accountId: string) =>
    router.push({ pathname: '/accounts/[id]', params: { id: accountId } });

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Button
        variant="ghost"
        icon={ArrowLeft}
        label={t('common.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text variant="headingXl" role="heading">
        {t('route.title')}
      </Text>
      {stops.length === 0 ? (
        <EmptyState icon={Route} title={t('today.empty')}>
          {t('route.empty_body')}
        </EmptyState>
      ) : (
        <>
          {placed.length > 0 ? (
            <PhoneMap
              label={t('route.map_label')}
              fit={[...placed.map((stop) => stop.at), ...(me ? [me] : [])]}
              frame={`${placed.length}:${me ? 'me' : fix.status}`}
              height={320}
            >
              <Line path={placed.map((stop) => stop.at)} />
              {placed.map((stop) => (
                <Spot
                  key={stop.item.id}
                  at={stop.at}
                  label={stop.number}
                  tone={TONE[stop.item.status] ?? 'accent'}
                  title={`${stop.number}. ${stop.name}`}
                  onPress={() => open(stop.item.accountId)}
                />
              ))}
              {me ? <Spot at={me} title={t('visit.you')} tone="info" /> : null}
            </PhoneMap>
          ) : null}
          <ListGroup title={t('route.stops', { count: stops.length })}>
            {stops.map((stop) => (
              <ListRow
                key={stop.item.id}
                {...(stop.at ? {} : { icon: MapPinOff })}
                label={`${stop.number}. ${stop.name}`}
                detail={[t(`plan.status_${stop.item.status}`), stop.at ? null : t('route.no_place')]
                  .filter(Boolean)
                  .join(' · ')}
                tone={stop.item.status === 'missed' ? 'danger' : 'default'}
                onPress={() => open(stop.item.accountId)}
              />
            ))}
          </ListGroup>
        </>
      )}
    </Screen>
  );
}
