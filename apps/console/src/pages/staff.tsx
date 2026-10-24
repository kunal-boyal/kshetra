import { formatDateTime } from '@thelamp/i18n';
import { newId, PLATFORM_ROLES, type StaffResult } from '@thelamp/shared';
import {
  type BadgeVariant,
  Button,
  Card,
  type Column,
  Confirm,
  DataTable,
  Notice,
  SelectField,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { Copy } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, useStaff } from '../data';
import { VIEWER_TIME_ZONE } from './shared';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';

const STATUS_BADGE: Record<StaffResult['status'], BadgeVariant> = {
  invited: 'waiting',
  active: 'success',
  disabled: 'neutral',
};

/**
 * The vendor's staff (decision D88): who may use the console and in what role, inviting someone
 * with a setup link shown once, and disabling someone for good.
 */
export function StaffPage() {
  const { client } = useConsole();
  const { t, locale } = useLanguage();
  const staff = useStaff();
  const { invite, disable } = useConsoleMutations();
  const [id, setId] = useState(newId);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffResult['role']>('support');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const [link, setLink] = useState<{ name: string; url: string }>();
  const [copied, setCopied] = useState(false);
  const [disabling, setDisabling] = useState<StaffResult>();

  async function send(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    try {
      const result = await invite.mutateAsync({ id, email: email.trim(), name: name.trim(), role });
      setLink({ name: result.staff.name, url: result.setupUrl });
      setCopied(false);
      setId(newId());
      setEmail('');
      setName('');
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  const columns: Column<StaffResult>[] = [
    { key: 'name', header: t('console.col_name'), render: (row) => row.name },
    { key: 'email', header: t('console.email'), render: (row) => row.email },
    { key: 'role', header: t('console.col_role'), render: (row) => t(`console.role_${row.role}`) },
    {
      key: 'status',
      header: t('console.col_status'),
      render: (row) => (
        <StatusBadge variant={STATUS_BADGE[row.status]}>
          {t(`console.staff_${row.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'last',
      header: t('console.col_last_sign_in'),
      render: (row) =>
        row.lastSignInAt
          ? formatDateTime(row.lastSignInAt, { locale, timeZone: VIEWER_TIME_ZONE })
          : '—',
    },
    {
      key: 'actions',
      header: t('console.col_actions'),
      render: (row) =>
        row.status !== 'disabled' && row.id !== client.staff?.id ? (
          <Button variant="ghost" size="sm" onClick={() => setDisabling(row)}>
            {t('console.disable')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <h1 className="heading-xl">{t('console.staff')}</h1>
      {disabling ? (
        <Confirm
          question={t('console.disable_question', { name: disabling.name })}
          action={
            <Button
              variant="danger"
              busy={disable.isPending}
              onClick={async () => {
                try {
                  await disable.mutateAsync(disabling.id);
                  setDisabling(undefined);
                } catch (error) {
                  setFailure(errorMessage(error, t));
                }
              }}
            >
              {t('console.disable')}
            </Button>
          }
          cancel={
            <Button variant="ghost" onClick={() => setDisabling(undefined)}>
              {t('common.cancel')}
            </Button>
          }
        >
          <p className="ks-muted">{t('console.disable_note')}</p>
        </Confirm>
      ) : null}
      {staff.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(staff.error, t)}
        </p>
      ) : (
        <DataTable
          caption={t('console.staff')}
          columns={columns}
          rows={staff.data?.items ?? []}
          rowKey={(row) => row.id}
        />
      )}
      <Card>
        <form className="flex max-w-xl flex-col gap-4" onSubmit={send} noValidate>
          <h2 className="heading-md">{t('console.invite_title')}</h2>
          <TextField
            label={t('console.col_name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            required
          />
          <TextField
            label={t('console.email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors.email}
            required
          />
          <SelectField
            label={t('console.col_role')}
            value={role}
            onChange={(event) => setRole(event.target.value as StaffResult['role'])}
            options={PLATFORM_ROLES.map((value) => ({
              value,
              label: t(`console.role_${value}`),
            }))}
            help={t(`console.role_help_${role}`)}
          />
          {failure ? (
            <p className="ks-help error" role="alert">
              {failure}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            busy={invite.isPending}
            disabled={!email.trim() || name.trim().length < 2}
          >
            {t('console.invite')}
          </Button>
        </form>
      </Card>
      {link ? (
        <Card>
          <div className="flex flex-col gap-3" aria-live="polite">
            <h2 className="heading-md">{t('console.link_title', { name: link.name })}</h2>
            <Notice>{t('console.link_once')}</Notice>
            <p className="font-mono break-all">{link.url}</p>
            <Button
              variant="secondary"
              className="self-start"
              icon={<Copy size={16} aria-hidden="true" />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? t('console.copied') : t('console.copy_link')}
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}
