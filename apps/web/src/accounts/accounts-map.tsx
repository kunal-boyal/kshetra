import { useNavigate } from '@tanstack/react-router';
import { errorMessage, useLanguage } from '../i18n';
import { useAccountPins } from '../maps/data';
import { Dot, MapView, seriesOf } from '../maps/map';
import { useAccountTypes } from './data';

/**
 * An account type's located accounts on a map (M4, M17), in the type's colour and filled once
 * visited this month; a click
 * opens the account. Accounts without a verified place aren't drawn.
 */
export function AccountsMap({ type, name }: { type: string; name: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const pins = useAccountPins();
  const series = seriesOf(useAccountTypes() ?? [], type);
  const items = (pins.data?.items ?? []).filter((pin) => pin.type === type);
  if (pins.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(pins.error, t)}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <MapView
        label={t('accounts.map_label', { type: name })}
        fit={items.map((pin) => pin.location)}
      >
        {items.map((pin) => (
          <Dot
            key={pin.id}
            at={pin.location}
            series={series}
            hollow={!pin.visited}
            title={`${pin.name} (${pin.code})`}
            onClick={() =>
              void navigate({ to: '/accounts/$accountId', params: { accountId: pin.id } })
            }
          />
        ))}
      </MapView>
      {pins.data ? (
        <p className="ks-muted text-sm">
          {t('accounts.map_count', { count: items.length })}
          {pins.data.truncated ? ` ${t('accounts.map_truncated')}` : ''}
        </p>
      ) : null}
    </div>
  );
}
