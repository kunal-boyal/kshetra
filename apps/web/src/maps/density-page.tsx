import { DENSITY_CELL_DEG, todayIn } from '@thelamp/shared';
import { TextField } from '@thelamp/ui-web';
import { useState } from 'react';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader } from '../people/shared';
import { useDensity } from './data';
import { Area, MapView } from './map';

/** A cell's radius in metres: half the grid's spacing, about 550 m. */
const CELL_RADIUS_M = (DENSITY_CELL_DEG * 111_320) / 2;

/**
 * Visit density over a month (M17): the scope's check-ins counted on a grid of about a kilometre,
 * each cell a circle shaded by its share of the busiest cell.
 */
export function DensityPage() {
  const { t } = useLanguage();
  const access = useAccess();
  const [period, setPeriod] = useState(() => todayIn(access.timezone).slice(0, 7));
  const density = useDensity(period);
  const cells = density.data?.cells ?? [];
  const most = Math.max(1, ...cells.map((cell) => cell.visits));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('density.title')}
        intro={t('density.intro')}
        back={{ to: '/live-map', label: t('live.title') }}
      />
      <TextField
        label={t('plan.month')}
        type="month"
        className="max-w-xs"
        value={period}
        onChange={(event) => {
          if (event.target.value) setPeriod(event.target.value);
        }}
      />
      {density.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(density.error, t)}
        </p>
      ) : !density.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <p>{t('density.summary', { count: density.data.visits, cells: cells.length })}</p>
          <MapView label={t('density.map_label')} fit={cells}>
            {cells.map((cell) => (
              <Area
                key={`${cell.lat},${cell.lng}`}
                at={cell}
                radius={CELL_RADIUS_M}
                weight={0.15 + 0.6 * (cell.visits / most)}
              />
            ))}
          </MapView>
          {cells.length > 0 ? (
            <table className="ks-table">
              <caption className="sr-only">{t('density.table_caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('density.place')}</th>
                  <th scope="col" className="r">
                    {t('density.visits')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...cells]
                  .sort((a, b) => b.visits - a.visits)
                  .slice(0, 10)
                  .map((cell) => (
                    <tr key={`${cell.lat},${cell.lng}`}>
                      <th scope="row">
                        {cell.lat.toFixed(3)}, {cell.lng.toFixed(3)}
                      </th>
                      <td className="r">{cell.visits}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </div>
  );
}
