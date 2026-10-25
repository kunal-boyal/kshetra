import { formatDateTime } from '@thelamp/i18n';
import {
  type AnnouncementStatus,
  type AnnouncementSurfaceKey,
  type AnnouncementToneKey,
  type ConsoleAnnouncement,
  newId,
} from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Card,
  Checkbox,
  ChoiceGroup,
  type Column,
  Confirm,
  DataTable,
  Notice,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '@thelamp/ui-web';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useAnnouncements, useConsoleMutations, useTenants } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds, VIEWER_TIME_ZONE } from './shared';

const STATUS_BADGE: Record<AnnouncementStatus, BadgeVariant> = {
  scheduled: 'info',
  showing: 'success',
  ended: 'neutral',
  withdrawn: 'neutral',
};

/** A moment as a `datetime-local` input shows it, in the viewer's own time zone. */
function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * Announcements to tenants (module M22, decision D93): what was announced, to whom, where and
 * when, with withdrawing; and, for those who manage tenants, announcing something new.
 */
export function AnnouncementsPage() {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const announcements = useAnnouncements();
  const { withdraw } = useConsoleMutations();
  const [withdrawing, setWithdrawing] = useState<ConsoleAnnouncement>();
  const [failure, setFailure] = useState<string>();
  const manages = holds(client.staff, 'platform.tenant.manage');
  const moment = (iso: string) => formatDateTime(iso, { locale, timeZone: VIEWER_TIME_ZONE });

  const columns: Column<ConsoleAnnouncement>[] = [
    { key: 'title', header: t('console.col_title'), render: (row) => row.title[locale] },
    {
      key: 'tone',
      header: t('console.col_tone'),
      render: (row) => t(`console.announce_tone_${row.tone}`),
    },
    {
      key: 'where',
      header: t('console.col_where'),
      render: (row) => row.surfaces.map((surface) => t(`console.announce_${surface}`)).join(', '),
    },
    {
      key: 'who',
      header: t('console.col_who'),
      render: (row) =>
        row.tenants
          ? row.tenants.map((tenant) => tenant.name).join(', ')
          : t('console.announce_all'),
    },
    {
      key: 'window',
      header: t('console.col_window'),
      render: (row) => `${moment(row.startsAt)} – ${moment(row.endsAt)}`,
    },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => (
        <StatusBadge variant={STATUS_BADGE[row.status]}>
          {t(`console.announce_status_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: t('console.col_actions'),
      render: (row) =>
        manages && (row.status === 'scheduled' || row.status === 'showing') ? (
          <Button size="sm" variant="ghost" onClick={() => setWithdrawing(row)}>
            {t('console.announce_withdraw')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <h1 className="heading-xl">{t('console.announcements')}</h1>
      <p className="ks-muted">{t('console.announcements_intro')}</p>
      {withdrawing ? (
        <Confirm
          question={t('console.announce_withdraw_question', {
            title: withdrawing.title[locale],
          })}
          action={
            <Button
              variant="danger"
              busy={withdraw.isPending}
              onClick={async () => {
                setFailure(undefined);
                try {
                  await withdraw.mutateAsync(withdrawing.id);
                  setWithdrawing(undefined);
                } catch (error) {
                  setFailure(errorMessage(error, t));
                }
              }}
            >
              {t('console.announce_withdraw')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setWithdrawing(undefined)}>
              {t('common.cancel')}
            </Button>
          }
        />
      ) : null}
      {failure ? (
        <p className="ks-help error" role="alert">
          {failure}
        </p>
      ) : null}
      {announcements.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(announcements.error, t)}
        </p>
      ) : !announcements.data ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : announcements.data.items.length === 0 ? (
        <p className="ks-muted">{t('console.announcements_none')}</p>
      ) : (
        <DataTable
          caption={t('console.announcements')}
          columns={columns}
          rows={announcements.data.items}
          rowKey={(row) => row.id}
        />
      )}
      {manages ? <AnnounceForm /> : null}
    </>
  );
}

function AnnounceForm() {
  const { t } = useLanguage();
  const { announce } = useConsoleMutations();
  const [id, setId] = useState(newId);
  const [title, setTitle] = useState({ en: '', hi: '' });
  const [body, setBody] = useState({ en: '', hi: '' });
  const [tone, setTone] = useState<AnnouncementToneKey>('info');
  const [surfaces, setSurfaces] = useState<AnnouncementSurfaceKey[]>(['web', 'mobile']);
  const [audience, setAudience] = useState<'all' | 'some'>('all');
  const [chosen, setChosen] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => localInput(new Date(Date.now() + 86_400_000)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [sent, setSent] = useState(false);
  const found = useTenants({ q: search.trim() || undefined });
  const matches = audience === 'some' ? (found.data?.pages[0]?.items ?? []).slice(0, 8) : [];

  const toggle = (surface: AnnouncementSurfaceKey, on: boolean) =>
    setSurfaces((now) => (on ? [...now, surface] : now.filter((one) => one !== surface)));

  async function send(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    setSent(false);
    try {
      await announce.mutateAsync({
        id,
        title: { en: title.en.trim(), hi: title.hi.trim() },
        body: { en: body.en.trim(), hi: body.hi.trim() },
        tone,
        surfaces,
        tenantIds: audience === 'all' ? null : chosen.map((tenant) => tenant.id),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setSent(true);
      setId(newId());
      setTitle({ en: '', hi: '' });
      setBody({ en: '', hi: '' });
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <Card>
      <form className="flex max-w-2xl flex-col gap-4" onSubmit={send} noValidate>
        <h2 className="heading-md">{t('console.announce_title')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('console.announce_title_en')}
            value={title.en}
            maxLength={80}
            onChange={(event) => setTitle({ ...title, en: event.target.value })}
            error={errors['title.en']}
            required
          />
          <TextField
            label={t('console.announce_title_hi')}
            lang="hi"
            value={title.hi}
            maxLength={80}
            onChange={(event) => setTitle({ ...title, hi: event.target.value })}
            error={errors['title.hi']}
            required
          />
          <TextAreaField
            label={t('console.announce_body_en')}
            value={body.en}
            maxLength={500}
            rows={3}
            onChange={(event) => setBody({ ...body, en: event.target.value })}
            error={errors['body.en']}
            required
          />
          <TextAreaField
            label={t('console.announce_body_hi')}
            lang="hi"
            value={body.hi}
            maxLength={500}
            rows={3}
            onChange={(event) => setBody({ ...body, hi: event.target.value })}
            error={errors['body.hi']}
            required
          />
        </div>
        <SelectField
          label={t('console.announce_tone')}
          value={tone}
          onChange={(event) => setTone(event.target.value as AnnouncementToneKey)}
          options={[
            { value: 'info', label: t('console.announce_tone_info') },
            { value: 'warning', label: t('console.announce_tone_warning') },
          ]}
        />
        <ChoiceGroup legend={t('console.announce_where')} error={errors.surfaces}>
          <Checkbox
            label={t('console.announce_web')}
            checked={surfaces.includes('web')}
            onChange={(event) => toggle('web', event.target.checked)}
          />
          <Checkbox
            label={t('console.announce_mobile')}
            checked={surfaces.includes('mobile')}
            onChange={(event) => toggle('mobile', event.target.checked)}
          />
        </ChoiceGroup>
        <SelectField
          label={t('console.col_who')}
          value={audience}
          onChange={(event) => setAudience(event.target.value as 'all' | 'some')}
          options={[
            { value: 'all', label: t('console.announce_everyone') },
            { value: 'some', label: t('console.announce_some') },
          ]}
        />
        {audience === 'some' ? (
          <div className="flex flex-col gap-2">
            <TextField
              label={t('console.announce_find')}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {[...chosen, ...matches.filter((one) => !chosen.some((c) => c.id === one.id))].map(
              (tenant) => (
                <Checkbox
                  key={tenant.id}
                  label={tenant.name}
                  checked={chosen.some((one) => one.id === tenant.id)}
                  onChange={(event) =>
                    setChosen((now) =>
                      event.target.checked
                        ? [...now, { id: tenant.id, name: tenant.name }]
                        : now.filter((one) => one.id !== tenant.id),
                    )
                  }
                />
              ),
            )}
            {errors.tenantIds ? <p className="ks-help error">{errors.tenantIds}</p> : null}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('console.announce_starts')}
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            error={errors.startsAt}
            required
          />
          <TextField
            label={t('console.announce_ends')}
            type="datetime-local"
            help={t('console.announce_window_help')}
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            error={errors.endsAt}
            required
          />
        </div>
        {failure && Object.keys(errors).length === 0 ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        {sent ? <Notice>{t('console.announce_sent')}</Notice> : null}
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          busy={announce.isPending}
          disabled={
            !title.en.trim() ||
            !title.hi.trim() ||
            !body.en.trim() ||
            !body.hi.trim() ||
            surfaces.length === 0 ||
            (audience === 'some' && chosen.length === 0)
          }
        >
          {t('console.announce_send')}
        </Button>
      </form>
    </Card>
  );
}
