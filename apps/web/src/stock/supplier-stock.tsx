import { formatNumber } from '@thelamp/i18n';
import { stockShortfall } from '@thelamp/shared';
import { Icon, Notice } from '@thelamp/ui-web';
import { PackageX } from 'lucide-react';
import { useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { useStock } from './data';

/**
 * Where a supplying account holds less than an order asks for (BR-62, decision D130): each short
 * item and by how much, against the supplier's stock now. A short order is only flagged, never
 * refused; nothing shows without stock to see, or when the supplier keeps none.
 */
export function SupplierShortfall({
  supplier,
  lines,
}: {
  supplier: { id: string; name: string } | null;
  lines: readonly { itemId: string; name: string; baseUnits: string; unit: string }[];
}) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const stock = useStock(supplier?.id ?? null, access.can('stock.view'));
  if (!supplier || !stock.data || lines.length === 0) return null;
  const onHand = new Map(stock.data.items.map((level) => [level.item.id, level.onHand]));
  const short = stockShortfall(lines, onHand);
  if (short.length === 0) return null;
  const named = new Map(lines.map((line) => [line.itemId, line]));
  return (
    <Notice icon={<Icon icon={PackageX} />}>
      {t('stock.supplier_short', {
        name: supplier.name,
        items: short
          .map((entry) =>
            t('stock.short_item', {
              item: named.get(entry.itemId)?.name ?? '',
              short: formatNumber(entry.short as `${number}`, { locale }),
              unit: named.get(entry.itemId)?.unit ?? '',
            }),
          )
          .join('; '),
      })}
    </Notice>
  );
}
