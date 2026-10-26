import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@thelamp/i18n';
import {
  newId,
  WEBHOOK_EVENTS,
  WebhookDelivery as DeliverySchema,
  type WebhookDelivery,
  WebhookDeliveryList,
  type WebhookEventKey,
  WebhookList,
  WebhookReplayResult,
  type WebhookResult,
  WebhookResult as ResultSchema,
  WebhookSecret,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Checkbox,
  ChoiceGroup,
  type Column,
  Confirm,
  DataTable,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';
import { SecretPanel } from './secret';

const KEY = ['webhooks'];
const LOG_PAGE = 20;

const MESSAGE_BADGE: Record<WebhookDelivery['messageStatus'], BadgeVariant> = {
  pending: 'waiting',
  delivered: 'success',
  failed: 'danger',
};

/** An event in the reader's words; the test message too. */
function useEventName() {
  const { t } = useLanguage();
  return (event: string) => t(`webhooks.event_${event}` as never);
}

/**
 * Webhooks (module M20, spec 12.4, decision D94), for holders of `webhook.manage`: receivers of
 * the organisation's events, each with its address, events and signing secret, shown once; a
 * test, a pause, a new secret, and the log of every try with a way to send a message again.
 */
export function WebhooksPage() {
  const { client } = useApp();
  const { t } = useLanguage();
  const webhooks = useQuery({
    queryKey: KEY,
    queryFn: () => read(client, '/v1/webhooks', WebhookList),
  });
  const [shown, setShown] = useState<{ webhook: WebhookResult; secret: string }>();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('webhooks.title')} intro={t('webhooks.intro')} />
      {shown ? (
        <SecretPanel
          title={t('webhooks.secret_title', { url: shown.webhook.url })}
          warning={t('webhooks.secret_once')}
          values={[[t('webhooks.secret_label'), shown.secret]]}
          done={t('webhooks.done')}
          onDone={() => setShown(undefined)}
        />
      ) : null}
      <WebhookForm
        onSaved={(made) => {
          if ('secret' in made) setShown(made);
        }}
      />
      <Section title={t('webhooks.list_title')}>
        {webhooks.isError ? (
          <p className="ks-help error" role="alert">
            {errorMessage(webhooks.error, t)}
          </p>
        ) : !webhooks.data ? (
          <p className="ks-muted">{t('common.loading')}</p>
        ) : webhooks.data.items.length === 0 ? (
          <p className="ks-muted">{t('webhooks.none')}</p>
        ) : (
          webhooks.data.items.map((webhook) => (
            <Webhook key={webhook.id} webhook={webhook} onRotated={setShown} />
          ))
        )}
      </Section>
    </div>
  );
}

/** A new webhook, or the address, description and events of one already made. */
function WebhookForm({
  current,
  onSaved,
  onCancel,
}: {
  current?: WebhookResult;
  onSaved: (saved: { webhook: WebhookResult; secret: string } | WebhookResult) => void;
  onCancel?: () => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const eventName = useEventName();
  // A new webhook's own ID, kept until it is made, so a retried request makes it once.
  const [id, setId] = useState(newId);
  const [url, setUrl] = useState(current?.url ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [events, setEvents] = useState<WebhookEventKey[]>(current?.events ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    if (events.length === 0) {
      setErrors({ events: t('webhooks.events_needed') });
      return;
    }
    setBusy(true);
    const body = {
      url: url.trim(),
      events: WEBHOOK_EVENTS.filter((key) => events.includes(key)),
      description: description.trim() || null,
    };
    try {
      if (current) {
        const saved = await write(
          client,
          'PATCH',
          `/v1/webhooks/${current.id}`,
          ResultSchema,
          body,
        );
        if (saved) onSaved(saved);
      } else {
        const made = await write(client, 'POST', '/v1/webhooks', WebhookSecret, {
          id,
          url: body.url,
          events: body.events,
          ...(body.description ? { description: body.description } : {}),
        });
        if (made) onSaved(made);
        setId(newId());
        setUrl('');
        setDescription('');
        setEvents([]);
      }
      await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="flex flex-col gap-4" onSubmit={save} noValidate>
      <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label={t('webhooks.url')}
          help={t('webhooks.url_help')}
          type="url"
          inputMode="url"
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          {...(errors.url ? { error: errors.url } : {})}
        />
        <TextField
          label={t('webhooks.description')}
          help={t('webhooks.description_help')}
          maxLength={200}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          {...(errors.description ? { error: errors.description } : {})}
        />
      </div>
      <ChoiceGroup
        legend={t('webhooks.events')}
        {...(errors.events ? { error: errors.events } : {})}
      >
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {WEBHOOK_EVENTS.map((key) => (
            <Checkbox
              key={key}
              label={eventName(key)}
              detail={key}
              checked={events.includes(key)}
              onChange={(event) =>
                setEvents((now) =>
                  event.target.checked ? [...now, key] : now.filter((item) => item !== key),
                )
              }
            />
          ))}
        </div>
      </ChoiceGroup>
      {failure && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {current ? t('webhooks.save') : t('webhooks.create')}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
  return current ? form : <Section title={t('webhooks.new_title')}>{form}</Section>;
}

function Webhook({
  webhook,
  onRotated,
}: {
  webhook: WebhookResult;
  onRotated: (made: { webhook: WebhookResult; secret: string }) => void;
}) {
  const { client } = useApp();
  const queryClient = useQueryClient();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const eventName = useEventName();
  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [busy, setBusy] = useState<'pause' | 'test' | 'rotate'>();
  const [failure, setFailure] = useState<unknown>();
  const [tested, setTested] = useState<WebhookDelivery>();
  const at = (time: string) => formatDateTime(time, { locale, timeZone: access.timezone });

  async function act(kind: 'pause' | 'test' | 'rotate') {
    setBusy(kind);
    setFailure(undefined);
    setTested(undefined);
    try {
      if (kind === 'pause') {
        await write(client, 'PATCH', `/v1/webhooks/${webhook.id}`, ResultSchema, {
          status: webhook.status === 'active' ? 'paused' : 'active',
        });
      } else if (kind === 'test') {
        setTested(await write(client, 'POST', `/v1/webhooks/${webhook.id}/test`, DeliverySchema));
        await queryClient.invalidateQueries({ queryKey: [...KEY, webhook.id] });
      } else {
        const rotated = await write(
          client,
          'POST',
          `/v1/webhooks/${webhook.id}/rotate`,
          WebhookSecret,
        );
        if (rotated) onRotated(rotated);
        setRotating(false);
      }
      await queryClient.invalidateQueries({ queryKey: KEY, exact: true });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <article
      className="flex flex-col gap-3 border-t border-[var(--border)] pt-3 first:border-0 first:pt-0"
      aria-label={webhook.url}
    >
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 break-all font-semibold">{webhook.url}</code>
        <StatusBadge variant={webhook.status === 'active' ? 'success' : 'neutral'}>
          {t(`webhooks.status_${webhook.status}`)}
        </StatusBadge>
      </div>
      {webhook.description ? <p>{webhook.description}</p> : null}
      <p className="ks-muted">{webhook.events.map(eventName).join(', ')}</p>
      {webhook.status === 'paused' ? <p className="ks-muted">{t('webhooks.paused_note')}</p> : null}
      <p className="ks-muted">
        {webhook.lastDelivery
          ? t(`webhooks.last_${webhook.lastDelivery.status}`, { time: at(webhook.lastDelivery.at) })
          : t('webhooks.never')}
      </p>
      {tested ? (
        <p role="status" className={tested.status === 'delivered' ? undefined : 'ks-help error'}>
          {tested.status === 'delivered'
            ? t('webhooks.test_delivered', {
                code: String(tested.responseCode ?? ''),
                ms: String(tested.durationMs),
              })
            : t('webhooks.test_failed', {
                reason:
                  tested.responseCode !== null
                    ? t('webhooks.answered', { code: String(tested.responseCode) })
                    : (tested.error ?? ''),
              })}
        </p>
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </p>
      ) : null}
      {editing ? (
        <WebhookForm
          current={webhook}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : rotating ? (
        <Confirm
          question={t('webhooks.rotate_question')}
          action={
            <Button variant="primary" busy={busy === 'rotate'} onClick={() => act('rotate')}>
              {t('webhooks.rotate')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setRotating(false)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            busy={busy === 'test'}
            disabled={webhook.status !== 'active'}
            onClick={() => act('test')}
          >
            {t('webhooks.test')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {t('webhooks.change')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            busy={busy === 'pause'}
            onClick={() => act('pause')}
          >
            {webhook.status === 'active' ? t('webhooks.pause') : t('webhooks.resume')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRotating(true)}>
            {t('webhooks.rotate')}
          </Button>
        </div>
      )}
      <Log webhook={webhook} />
    </article>
  );
}

/** Every try, newest first, a page at a time, with a way to send a message again. */
function Log({ webhook }: { webhook: WebhookResult }) {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const eventName = useEventName();
  const [open, setOpen] = useState(false);
  const log = useInfiniteQuery({
    queryKey: [...KEY, webhook.id, 'log'],
    enabled: open,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      read(
        client,
        `/v1/webhooks/${webhook.id}/deliveries?limit=${LOG_PAGE}${pageParam ? `&cursor=${pageParam}` : ''}`,
        WebhookDeliveryList,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((page) => page.items) ?? [];
  const columns: Column<WebhookDelivery>[] = [
    {
      key: 'time',
      header: t('webhooks.col_time'),
      render: (row) => formatDateTime(row.createdAt, { locale, timeZone: access.timezone }),
    },
    { key: 'event', header: t('webhooks.col_event'), render: (row) => eventName(row.event) },
    {
      key: 'attempt',
      header: t('webhooks.col_attempt'),
      align: 'end',
      render: (row) => String(row.attempt),
    },
    {
      key: 'result',
      header: t('webhooks.col_result'),
      render: (row) =>
        row.status === 'delivered'
          ? t('webhooks.result_delivered')
          : [t('webhooks.result_failed'), row.responseCode ?? row.error]
              .filter(Boolean)
              .join(' · '),
    },
    {
      key: 'message',
      header: t('webhooks.col_message'),
      render: (row) => <MessageState webhookId={webhook.id} delivery={row} />,
    },
  ];
  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer">{t('webhooks.log')}</summary>
      {log.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(log.error, t)}
        </p>
      ) : !log.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('webhooks.log')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={<p className="ks-muted">{t('webhooks.log_none')}</p>}
          {...(log.hasNextPage
            ? {
                more: {
                  label: t('common.load_more'),
                  busy: log.isFetchingNextPage,
                  onClick: () => void log.fetchNextPage(),
                },
              }
            : {})}
        />
      )}
    </details>
  );
}

/** Where a try's message stands now, and Send again for one that won't be tried again. */
function MessageState({ webhookId, delivery }: { webhookId: string; delivery: WebhookDelivery }) {
  const { client } = useApp();
  const { t } = useLanguage();
  const [state, setState] = useState<'idle' | 'busy' | 'queued'>('idle');
  const [failure, setFailure] = useState<unknown>();
  const badge = (
    <StatusBadge variant={MESSAGE_BADGE[delivery.messageStatus]}>
      {t(`webhooks.message_${delivery.messageStatus}`)}
    </StatusBadge>
  );
  if (delivery.messageStatus === 'pending' || delivery.event === 'webhook.test') return badge;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {badge}
      {state === 'queued' ? (
        <span role="status">{t('webhooks.resent')}</span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          busy={state === 'busy'}
          onClick={async () => {
            setState('busy');
            setFailure(undefined);
            try {
              await write(
                client,
                'POST',
                `/v1/webhooks/${webhookId}/messages/${delivery.messageId}/replay`,
                WebhookReplayResult,
              );
              setState('queued');
            } catch (error) {
              setFailure(error);
              setState('idle');
            }
          }}
        >
          {t('webhooks.resend')}
        </Button>
      )}
      {failure ? (
        <span className="ks-help error" role="alert">
          {errorMessage(failure, t)}
        </span>
      ) : null}
    </span>
  );
}
