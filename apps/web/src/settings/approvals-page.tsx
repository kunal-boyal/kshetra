import { type Approver, type ChainView, REQUEST_FACTS, type WorkflowStep } from '@thelamp/forms';
import { ACCOUNT_REQUEST_TYPES, type Locale, type RequestType } from '@thelamp/shared';
import {
  Button,
  Icon,
  List,
  ListItem,
  SelectField,
  SplitDetail,
  StatusBadge,
  TextField,
} from '@thelamp/ui-web';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../context';
import { useConfig } from '../data';
import { ConditionEditor } from '../forms/field-editor';
import { errorMessage, useLanguage } from '../i18n';
import { useDesignations, useRoles, useUsers } from '../people/data';
import { fieldErrors, PageHeader, Section, useDates } from '../people/shared';
import { useChains, useSaveChains } from './chains-data';
import { useTypeList } from './types-data';

const APPROVER_TYPES = [
  'reporting_manager',
  'nearest_designation',
  'role_in_scope',
  'account_slot',
  'specific_user',
] as const satisfies readonly Approver['type'][];

type Option = { value: string; label: string };

/** Who to choose from: the tenant's roles, designations, account slots and active people. */
interface Choices {
  roles: Option[];
  designations: Option[];
  slots: Option[];
  people: Option[];
}

/**
 * Approval chains (spec 5.9, decision D74): who decides each kind of request, step by step, and
 * the role that decides when no step remains. Each save is a new version; requests already
 * waiting keep the version that routed them.
 */
export function ApprovalChainsPage() {
  const { client, queryClient } = useApp();
  const { t, locale } = useLanguage();
  const chains = useChains();
  const save = useSaveChains();
  const roles = useRoles();
  const designations = useDesignations();
  const types = useTypeList();
  const people = useUsers({ status: 'active' }, 100);
  const config = useConfig(client, queryClient);
  const dates = useDates(config.data?.bundle.settings.timezone ?? 'Asia/Kolkata');
  const [editing, setEditing] = useState<RequestType | null>(null);
  const [shown, setShown] = useState<RequestType | null>(null);
  const [fallbackError, setFallbackError] = useState<unknown>();
  const [saved, setSaved] = useState<string | null>(null);
  if (!chains.data) return <p className="ks-muted">{t('common.loading')}</p>;

  const choices: Choices = {
    roles: (roles.data ?? []).map((role) => ({ value: role.key, label: role.name[locale] })),
    designations: (designations.data ?? []).map((entry) => ({
      value: entry.key,
      label: entry.name[locale].one,
    })),
    slots: [
      ...new Map(
        (types.data ?? []).flatMap((type) =>
          type.slots.map((slot) => [slot.key, slot.name[locale]] as const),
        ),
      ),
    ].map(([value, label]) => ({ value, label })),
    people: (people.data?.pages ?? [])
      .flatMap((page) => page.items)
      .map((person) => ({ value: person.id, label: `${person.name} (${person.code})` })),
  };

  async function setFallback(role: string) {
    setFallbackError(undefined);
    try {
      await save.fallback(role);
    } catch (caught) {
      setFallbackError(caught);
    }
  }

  const chosen =
    chains.data.chains.find((chain) => chain.requestType === shown) ?? chains.data.chains[0];
  const name = (type: RequestType) => t(`chains.type_${type}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('chains.title')} intro={t('chains.intro')} />
      <Section title={t('chains.fallback')}>
        <SelectField
          label={t('chains.role')}
          help={t('chains.fallback_help')}
          value={chains.data.fallbackRole}
          options={choices.roles}
          {...(fallbackError ? { error: errorMessage(fallbackError, t) } : {})}
          onChange={(event) => void setFallback(event.target.value)}
        />
      </Section>
      {saved ? (
        <p className="ks-notice" role="status">
          {saved}
        </p>
      ) : null}
      <SplitDetail
        detailLabel={chosen ? name(chosen.requestType) : t('chains.title')}
        list={
          <List label={t('chains.types')}>
            {chains.data.chains.map((chain) => (
              <ListItem
                key={chain.requestType}
                title={name(chain.requestType)}
                meta={summary(chain, choices, t)}
                selected={chain === chosen}
                onClick={() => {
                  setSaved(null);
                  setEditing(null);
                  setShown(chain.requestType);
                }}
              />
            ))}
          </List>
        }
        detail={
          chosen ? (
            <section
              key={chosen.requestType}
              className="flex flex-col gap-4"
              aria-label={name(chosen.requestType)}
            >
              <div className="ks-spread">
                <h2 className="heading-lg">{name(chosen.requestType)}</h2>
                {chosen.version === 0 ? (
                  <StatusBadge variant="neutral">{t('chains.badge_none')}</StatusBadge>
                ) : (
                  <StatusBadge variant="success">
                    {t('chains.badge_version', { version: chosen.version })}
                  </StatusBadge>
                )}
              </div>
              {editing === chosen.requestType ? (
                <ChainEditor
                  chain={chosen}
                  choices={choices}
                  onCancel={() => setEditing(null)}
                  onSave={async (steps) => {
                    const next = await save.chain(chosen.requestType, steps, chosen.version);
                    setEditing(null);
                    setSaved(t('chains.saved', { version: next.version }));
                  }}
                />
              ) : (
                <ChainSummary
                  chain={chosen}
                  choices={choices}
                  when={chosen.updatedAt ? dates.dateTime(chosen.updatedAt) : ''}
                  onEdit={() => {
                    setSaved(null);
                    setEditing(chosen.requestType);
                  }}
                />
              )}
            </section>
          ) : null
        }
      />
    </div>
  );
}

/** A request type's chain in one line: who decides, in order. */
function summary(chain: ChainView, choices: Choices, t: Translate): string {
  if (chain.version === 0) return t('chains.none_short');
  const conditional = chain.steps.filter((step) => step.condition).length;
  const line = chain.steps.map((step) => brief(step.approver, choices, t)).join(t('chains.then'));
  return conditional > 0 ? `${line} · ${t('chains.conditional')}` : line;
}

/** Who decides, in a few words: "Their manager", "Head", "Rahul Verma". */
function brief(approver: Approver, choices: Choices, t: Translate): string {
  const name = (list: Option[], key: string) =>
    list.find((entry) => entry.value === key)?.label ?? key;
  switch (approver.type) {
    case 'reporting_manager':
      return approver.level === 1
        ? t('chains.brief_manager')
        : t('chains.brief_manager_up', { level: approver.level });
    case 'nearest_designation':
      return name(choices.designations, approver.designation);
    case 'role_in_scope':
      return name(choices.roles, approver.role);
    case 'account_slot':
      return name(choices.slots, approver.slot);
    case 'specific_user':
      // People are listed as "Name (code)"; the name alone reads better in a line.
      return name(choices.people, approver.userId).replace(/ \(.*\)$/, '');
  }
}

/** "Leave days more than 3 and Paid leave equal to Yes", in the reader's language. */
function sentence(
  type: RequestType,
  condition: NonNullable<WorkflowStep['condition']>,
  t: Translate,
  locale: Locale,
): string {
  const facts = REQUEST_FACTS[type];
  const value = (entry: unknown) =>
    typeof entry === 'boolean'
      ? t(entry ? 'common.yes' : 'common.no')
      : Array.isArray(entry)
        ? entry.join(', ')
        : String(entry ?? '');
  return condition.clauses
    .map((clause) => {
      const field = facts.find((fact) => fact.key === clause.field);
      const label = field && 'label' in field ? field.label[locale] : clause.field;
      const empty = clause.op === 'is_empty' || clause.op === 'is_not_empty';
      return [label, t(`builder.op_${clause.op}`), ...(empty ? [] : [value(clause.value)])].join(
        ' ',
      );
    })
    .join(t(condition.match === 'any' ? 'chains.or' : 'chains.and'));
}

/** The chain's steps in order, those sharing a condition under it, then its version and Edit. */
function ChainSummary({
  chain,
  choices,
  when,
  onEdit,
}: {
  chain: ChainView;
  choices: Choices;
  when: string;
  onEdit: () => void;
}) {
  const { t, locale } = useLanguage();
  const roleName = (key: string) => choices.roles.find((role) => role.value === key)?.label ?? key;
  // Runs of steps that share a condition, numbered across the whole chain.
  const groups: { condition: WorkflowStep['condition']; steps: [number, WorkflowStep][] }[] = [];
  chain.steps.forEach((step, index) => {
    const last = groups.at(-1);
    if (last && JSON.stringify(last.condition) === JSON.stringify(step.condition)) {
      last.steps.push([index, step]);
    } else {
      groups.push({ condition: step.condition, steps: [[index, step]] });
    }
  });
  return (
    <div className="flex flex-col gap-4">
      {chain.version === 0 ? (
        <p className="ks-muted">{t('chains.none')}</p>
      ) : (
        <>
          {groups.map((group, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] p-4"
            >
              <p className="font-semibold">
                {group.condition
                  ? t('chains.when', {
                      condition: sentence(chain.requestType, group.condition, t, locale),
                    })
                  : t('chains.always')}
              </p>
              <ol className="ks-steps" aria-label={t('chains.steps')}>
                {group.steps.map(([n, step]) => {
                  const meta = [
                    ...(step.reminderAfterHours
                      ? [t('chains.reminder_after', { hours: step.reminderAfterHours })]
                      : []),
                    ...(step.escalation
                      ? [
                          t('chains.escalates', {
                            hours: step.escalation.afterHours,
                            role: roleName(step.escalation.to),
                          }),
                        ]
                      : []),
                    ...(step.escalateIfNoApprover
                      ? [t('chains.nobody_then', { role: roleName(step.escalateIfNoApprover) })]
                      : []),
                    ...(step.lineDecisions ? [t('chains.line_decisions')] : []),
                  ];
                  return (
                    <li key={n} className="ks-step">
                      <span className="ks-node">{n + 1}</span>
                      <div>
                        <p className="ks-title">{describe(step.approver, choices, t)}</p>
                        {meta.length ? <p className="ks-meta">{meta.join(' · ')}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          <p className="ks-meta">
            {chain.updatedBy
              ? t('chains.version_by', {
                  version: chain.version,
                  when,
                  name: chain.updatedBy.name,
                })
              : t('chains.version', { version: chain.version, when })}
          </p>
        </>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="self-start"
        icon={<Icon icon={Pencil} size="sm" />}
        aria-label={`${t('common.edit')}: ${t(`chains.type_${chain.requestType}`)}`}
        onClick={onEdit}
      >
        {t('common.edit')}
      </Button>
    </div>
  );
}

type Translate = ReturnType<typeof useLanguage>['t'];

function describe(approver: Approver, choices: Choices, t: Translate): string {
  const name = (list: Option[], key: string) =>
    list.find((entry) => entry.value === key)?.label ?? key;
  const kind = t(`chains.approver_${approver.type}`);
  switch (approver.type) {
    case 'reporting_manager':
      return `${kind} (${approver.level})`;
    case 'nearest_designation':
      return `${kind}: ${name(choices.designations, approver.designation)}`;
    case 'role_in_scope':
      return `${kind}: ${name(choices.roles, approver.role)}`;
    case 'account_slot':
      return `${kind}: ${name(choices.slots, approver.slot)}`;
    case 'specific_user':
      return `${kind}: ${name(choices.people, approver.userId)}`;
  }
}

/** A step without one of its optional settings. */
function without(
  step: WorkflowStep,
  key: 'condition' | 'escalateIfNoApprover' | 'reminderAfterHours' | 'escalation',
): WorkflowStep {
  const next = { ...step };
  delete next[key];
  return next;
}

/** A new approver of a type, with the first choice it needs filled in. */
function approverOf(type: Approver['type'], choices: Choices): Approver {
  switch (type) {
    case 'reporting_manager':
      return { type, level: 1 };
    case 'nearest_designation':
      return { type, designation: choices.designations[0]?.value ?? '' };
    case 'role_in_scope':
      return { type, role: choices.roles[0]?.value ?? '' };
    case 'account_slot':
      return { type, slot: choices.slots[0]?.value ?? '' };
    case 'specific_user':
      return { type, userId: choices.people[0]?.value ?? '' };
  }
}

function ChainEditor({
  chain,
  choices,
  onCancel,
  onSave,
}: {
  chain: ChainView;
  choices: Choices;
  onCancel: () => void;
  onSave: (steps: WorkflowStep[]) => Promise<void>;
}) {
  const { t } = useLanguage();
  const type = chain.requestType;
  const [steps, setSteps] = useState<WorkflowStep[]>(
    chain.steps.length > 0
      ? chain.steps
      : [{ approver: { type: 'reporting_manager', level: 1 }, lineDecisions: false }],
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);
  const accountRequest = (ACCOUNT_REQUEST_TYPES as readonly string[]).includes(type);
  const approverTypes = APPROVER_TYPES.filter((kind) => kind !== 'account_slot' || accountRequest);

  const update = (index: number, next: WorkflowStep) =>
    setSteps((current) => current.map((step, i) => (i === index ? next : step)));
  const move = (index: number, by: -1 | 1) =>
    setSteps((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSave(steps);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const hours = (
    value: number | undefined,
    set: (next: number | undefined) => void,
    label: string,
    path: string,
  ) => (
    <TextField
      label={label}
      help={t('chains.optional')}
      type="number"
      inputMode="numeric"
      min={1}
      max={720}
      value={value === undefined ? '' : String(value)}
      {...(errors[path] ? { error: errors[path] } : {})}
      onChange={(event) => set(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} aria-label={t(`chains.type_${type}`)}>
      {steps.map((step, index) => {
        const at = `steps[${index}]`;
        const approver = step.approver;
        return (
          <fieldset key={index} className="ks-card flat flex flex-col gap-3">
            <legend className="heading-md">{t('chains.step', { n: index + 1 })}</legend>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label={t('chains.approver')}
                value={approver.type}
                options={approverTypes.map((kind) => ({
                  value: kind,
                  label: t(`chains.approver_${kind}`),
                }))}
                {...(errors[`${at}.approver`] ? { error: errors[`${at}.approver`] } : {})}
                onChange={(event) =>
                  update(index, {
                    ...step,
                    approver: approverOf(event.target.value as Approver['type'], choices),
                  })
                }
              />
              {approver.type === 'reporting_manager' ? (
                <TextField
                  label={t('chains.level')}
                  help={t('chains.level_help')}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  value={String(approver.level)}
                  onChange={(event) =>
                    update(index, {
                      ...step,
                      approver: { ...approver, level: Number(event.target.value) || 1 },
                    })
                  }
                />
              ) : null}
              {approver.type === 'nearest_designation' ? (
                <SelectField
                  label={t('chains.designation')}
                  value={approver.designation}
                  options={choices.designations}
                  {...(errors[`${at}.approver.designation`]
                    ? { error: errors[`${at}.approver.designation`] }
                    : {})}
                  onChange={(event) =>
                    update(index, {
                      ...step,
                      approver: { ...approver, designation: event.target.value },
                    })
                  }
                />
              ) : null}
              {approver.type === 'role_in_scope' ? (
                <SelectField
                  label={t('chains.role')}
                  value={approver.role}
                  options={choices.roles}
                  {...(errors[`${at}.approver.role`]
                    ? { error: errors[`${at}.approver.role`] }
                    : {})}
                  onChange={(event) =>
                    update(index, { ...step, approver: { ...approver, role: event.target.value } })
                  }
                />
              ) : null}
              {approver.type === 'account_slot' ? (
                <SelectField
                  label={t('chains.slot')}
                  value={approver.slot}
                  options={choices.slots}
                  {...(errors[`${at}.approver.slot`]
                    ? { error: errors[`${at}.approver.slot`] }
                    : {})}
                  onChange={(event) =>
                    update(index, { ...step, approver: { ...approver, slot: event.target.value } })
                  }
                />
              ) : null}
              {approver.type === 'specific_user' ? (
                <SelectField
                  label={t('chains.person')}
                  value={approver.userId}
                  options={choices.people}
                  {...(errors[`${at}.approver.userId`]
                    ? { error: errors[`${at}.approver.userId`] }
                    : {})}
                  onChange={(event) =>
                    update(index, {
                      ...step,
                      approver: { ...approver, userId: event.target.value },
                    })
                  }
                />
              ) : null}
            </div>
            <ConditionEditor
              legend={t('chains.condition')}
              addLabel={t('chains.add_condition')}
              condition={step.condition}
              earlier={REQUEST_FACTS[type]}
              onChange={(condition) => {
                const rest = without(step, 'condition');
                update(index, condition ? { ...rest, condition } : rest);
              }}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label={t('chains.no_approver')}
                value={step.escalateIfNoApprover === undefined ? 'skip' : 'escalate'}
                options={[
                  { value: 'skip', label: t('chains.skip') },
                  { value: 'escalate', label: t('chains.escalate') },
                ]}
                onChange={(event) => {
                  const rest = without(step, 'escalateIfNoApprover');
                  update(
                    index,
                    event.target.value === 'skip'
                      ? rest
                      : { ...rest, escalateIfNoApprover: choices.roles[0]?.value ?? '' },
                  );
                }}
              />
              {step.escalateIfNoApprover !== undefined ? (
                <SelectField
                  label={t('chains.escalate_role')}
                  value={step.escalateIfNoApprover}
                  options={choices.roles}
                  {...(errors[`${at}.escalateIfNoApprover`]
                    ? { error: errors[`${at}.escalateIfNoApprover`] }
                    : {})}
                  onChange={(event) =>
                    update(index, { ...step, escalateIfNoApprover: event.target.value })
                  }
                />
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {hours(
                step.reminderAfterHours,
                (next) => {
                  const rest = without(step, 'reminderAfterHours');
                  update(index, next === undefined ? rest : { ...rest, reminderAfterHours: next });
                },
                t('chains.reminder'),
                `${at}.reminderAfterHours`,
              )}
              {hours(
                step.escalation?.afterHours,
                (next) => {
                  const rest = without(step, 'escalation');
                  update(
                    index,
                    next === undefined
                      ? rest
                      : {
                          ...rest,
                          escalation: {
                            afterHours: next,
                            to: step.escalation?.to ?? choices.roles[0]?.value ?? '',
                          },
                        },
                  );
                },
                t('chains.escalation_after'),
                `${at}.escalation.afterHours`,
              )}
              {step.escalation ? (
                <SelectField
                  label={t('chains.escalation_to')}
                  value={step.escalation.to}
                  options={choices.roles}
                  {...(errors[`${at}.escalation.to`]
                    ? { error: errors[`${at}.escalation.to`] }
                    : {})}
                  onChange={(event) =>
                    update(index, {
                      ...step,
                      escalation: { ...step.escalation!, to: event.target.value },
                    })
                  }
                />
              ) : null}
            </div>
            {type === 'order' ? (
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={step.lineDecisions}
                  onChange={(event) =>
                    update(index, { ...step, lineDecisions: event.target.checked })
                  }
                />
                <span>{t('chains.line_decisions')}</span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={index === 0}
                icon={<Icon icon={ArrowUp} size="sm" />}
                onClick={() => move(index, -1)}
              >
                {t('common.move_up')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={index === steps.length - 1}
                icon={<Icon icon={ArrowDown} size="sm" />}
                onClick={() => move(index, 1)}
              >
                {t('common.move_down')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={steps.length === 1}
                icon={<Icon icon={Trash2} size="sm" />}
                onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
              >
                {t('chains.remove_step', { n: index + 1 })}
              </Button>
            </div>
          </fieldset>
        );
      })}
      {error && Object.keys(errors).length === 0 ? (
        <p className="ks-help error" role="alert">
          {errorMessage(error, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={steps.length >= 10}
          icon={<Icon icon={Plus} size="sm" />}
          onClick={() =>
            setSteps((current) => [
              ...current,
              { approver: approverOf('reporting_manager', choices), lineDecisions: false },
            ])
          }
        >
          {t('chains.add_step')}
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
          icon={<Icon icon={Save} size="sm" />}
        >
          {t('chains.save')}
        </Button>
      </div>
    </form>
  );
}
