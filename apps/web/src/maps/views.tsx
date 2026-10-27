import { SegmentedControl } from '@thelamp/ui-web';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';

/** The map's views: people now, a person's day, where visits happened, and the accounts. */
export type MapViewKey = 'live' | 'replay' | 'density' | 'pins';

/**
 * The switch between the map's views (decision D104), on the live map and the density page alike.
 * Day replay needs `trail.view`.
 */
export function MapViews({
  value,
  onChange,
}: {
  value: MapViewKey;
  onChange: (view: MapViewKey) => void;
}) {
  const { t } = useLanguage();
  const access = useAccess();
  const views: MapViewKey[] = access.can('trail.view')
    ? ['live', 'replay', 'density', 'pins']
    : ['live', 'density', 'pins'];
  return (
    <SegmentedControl
      label={t('live.views')}
      value={value}
      onChange={onChange}
      choices={views.map((view) => ({ value: view, label: t(`live.view_${view}`) }))}
    />
  );
}

/** The live map's view in its address, so the density page can link back to pins or a replay. */
export function liveMapSearch(search: Record<string, unknown>): { view?: 'pins' | 'replay' } {
  return search.view === 'pins' || search.view === 'replay' ? { view: search.view } : {};
}
