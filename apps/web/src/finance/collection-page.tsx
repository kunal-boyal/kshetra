import { amountInWords } from '@thelamp/i18n';
import { errorMessage, useLanguage } from '../i18n';
import { useAccess } from '../people/data';
import { PageHeader, useDates } from '../people/shared';
import { Printable, PrintButton } from '../print';
import {
  ChequePhoto,
  CollectionActions,
  CollectionBadge,
  CollectionFacts,
  paidBy,
  useMoney,
} from './collection-parts';
import { useCollection } from './collections-data';

/**
 * One collection (M11, BR-63, decision D132): what it says and what the office decided, with the
 * receipt the shop may be given, printed or saved as a PDF from the browser (decision D99). A
 * receipt for money the office hasn't confirmed says so.
 */
export function CollectionPage({ collectionId }: { collectionId: string }) {
  const { t, locale } = useLanguage();
  const access = useAccess();
  const dates = useDates(access.timezone);
  const money = useMoney();
  const collection = useCollection(collectionId);
  const data = collection.data;
  const turnedDown = data?.status === 'rejected' || data?.status === 'bounced';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={data ? data.number : t('collections.title')}
        back={{ to: '/collections', label: t('collections.title') }}
        {...(data ? { meta: `${data.account.name} · ${data.account.code}` } : {})}
      >
        {data && !turnedDown ? (
          <PrintButton printable="collection-receipt" label={t('collections.print_receipt')} />
        ) : null}
      </PageHeader>
      {collection.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(collection.error, t)}
        </p>
      ) : !data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <>
          <section className="ks-card flex flex-col gap-4" aria-label={t('collections.details')}>
            <div className="ks-spread items-start gap-3">
              <h2 className="heading-md">{t('collections.details')}</h2>
              <CollectionBadge status={data.status} />
            </div>
            <CollectionFacts collection={data} />
            {data.photos.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {data.photos.map((photo, index) => (
                  <ChequePhoto key={photo} id={photo} index={index} />
                ))}
              </div>
            ) : null}
            <CollectionActions collection={data} />
          </section>
          {turnedDown ? null : (
            <Printable
              id="collection-receipt"
              title={t('collections.receipt_title', { number: data.number })}
              details={[`${data.account.name} (${data.account.code})`]}
            >
              <section
                className="ks-card flex flex-col gap-3"
                aria-label={t('collections.receipt_heading')}
              >
                <h2 className="heading-md">{t('collections.receipt_heading')}</h2>
                <p>
                  {t('collections.receipt_body', {
                    amount: money(data.amount),
                    account: data.account.name,
                    code: data.account.code,
                    date: dates.date(data.collectedOn),
                    paid: paidBy(data, t),
                  })}
                </p>
                <p className="ks-meta">{amountInWords(data.amount, locale)}</p>
                <p className="ks-meta">
                  {t('collections.receipt_by', { name: data.collector.name })}
                </p>
                {data.status === 'recorded' ? (
                  <p className="font-semibold">{t('collections.receipt_waiting')}</p>
                ) : null}
              </section>
            </Printable>
          )}
        </>
      )}
    </div>
  );
}
