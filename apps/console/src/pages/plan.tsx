import { Link, useNavigate } from '@tanstack/react-router';
import {
  AVAILABLE_MODULES,
  MODULE_KEYS,
  type ModuleKey,
  newId,
  type PlanResult,
} from '@thelamp/shared';
import { Button, Card, Checkbox, ChoiceGroup, TextField } from '@thelamp/ui-web';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useConsole } from '../context';
import { useConsoleMutations, usePlans } from '../data';
import { errorMessage, fieldErrors, useLanguage } from '../i18n';
import { holds, moduleName, PlanStatusBadge } from './shared';

interface AddonDraft {
  /** Only for React's keys; the API never sees it. */
  row: string;
  key: string;
  nameEn: string;
  nameHi: string;
  price: string;
}

interface PlanDraft {
  key: string;
  nameEn: string;
  nameHi: string;
  priceMonth: string;
  priceYear: string;
  modules: ModuleKey[];
  users: string;
  storageGb: string;
  active: boolean;
  addons: AddonDraft[];
}

function draftOf(plan: PlanResult | undefined): PlanDraft {
  return {
    key: plan?.key ?? '',
    nameEn: plan?.name.en ?? '',
    nameHi: plan?.name.hi ?? '',
    priceMonth: plan?.priceMonth ?? '',
    priceYear: plan?.priceYear ?? '',
    modules: plan?.modules ?? ['core'],
    users: plan?.limits.users?.toString() ?? '',
    storageGb: plan?.limits.storageGb?.toString() ?? '',
    active: plan?.active ?? true,
    addons: (plan?.addons ?? []).map((addon) => ({
      row: newId(),
      key: addon.key,
      nameEn: addon.name.en,
      nameHi: addon.name.hi,
      price: addon.price,
    })),
  };
}

/** What the API takes from the form: blank limits are no limit. */
function bodyOf(draft: PlanDraft) {
  return {
    key: draft.key.trim(),
    name: { en: draft.nameEn.trim(), hi: draft.nameHi.trim() },
    priceMonth: draft.priceMonth.trim(),
    priceYear: draft.priceYear.trim(),
    modules: MODULE_KEYS.filter((key) => draft.modules.includes(key)),
    limits: {
      users: draft.users ? Number(draft.users) : null,
      storageGb: draft.storageGb ? Number(draft.storageGb) : null,
    },
    addons: draft.addons.map((addon) => ({
      key: addon.key.trim(),
      name: { en: addon.nameEn.trim(), hi: addon.nameHi.trim() },
      price: addon.price.trim(),
    })),
    active: draft.active,
  };
}

/** A new plan. The form names its ID once, so sending it twice makes one plan. */
export function NewPlanPage() {
  const { t } = useLanguage();
  return (
    <>
      <BackToPlans />
      <h1 className="heading-xl">{t('console.new_plan')}</h1>
      <PlanForm />
    </>
  );
}

/** One plan, to change; its tenants follow the change at once (decision D89). */
export function PlanPage({ planId }: { planId: string }) {
  const { t, locale } = useLanguage();
  const plans = usePlans();
  if (plans.isError) {
    return (
      <p className="ks-help error" role="alert">
        {errorMessage(plans.error, t)}
      </p>
    );
  }
  if (!plans.data) return <p className="ks-muted">{t('common.loading')}</p>;
  const plan = plans.data.items.find((item) => item.id === planId);
  if (!plan) {
    return (
      <>
        <BackToPlans />
        <p className="ks-help error" role="alert">
          {t('console.plan_not_found')}
        </p>
      </>
    );
  }
  return (
    <>
      <BackToPlans />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="heading-xl">{plan.name[locale]}</h1>
        <PlanStatusBadge active={plan.active} />
      </div>
      {plan.tenants > 0 ? (
        <p className="ks-muted">{t('console.plan_tenants', { count: plan.tenants })}</p>
      ) : null}
      <PlanForm plan={plan} />
    </>
  );
}

function BackToPlans() {
  const { t } = useLanguage();
  return (
    <Link to="/plans" className="ks-btn ghost sm self-start">
      <ArrowLeft size={16} aria-hidden="true" />
      {t('console.plans')}
    </Link>
  );
}

function PlanForm({ plan }: { plan?: PlanResult }) {
  const { client } = useConsole();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { createPlan, updatePlan } = useConsoleMutations();
  const [id] = useState(newId);
  const [draft, setDraft] = useState(() => draftOf(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string>();
  const manages = holds(client.staff, 'platform.plan.manage');
  const busy = createPlan.isPending || updatePlan.isPending;

  const change = (patch: Partial<PlanDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const changeAddon = (row: string, patch: Partial<AddonDraft>) =>
    change({
      addons: draft.addons.map((addon) => (addon.row === row ? { ...addon, ...patch } : addon)),
    });
  const toggle = (key: ModuleKey, on: boolean) =>
    change({
      modules: on ? [...draft.modules, key] : draft.modules.filter((module) => module !== key),
    });

  async function save(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFailure(undefined);
    try {
      if (plan) await updatePlan.mutateAsync({ id: plan.id, body: bodyOf(draft) });
      else await createPlan.mutateAsync({ id, ...bodyOf(draft) });
      await navigate({ to: '/plans' });
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(errorMessage(error, t));
    }
  }

  return (
    <Card>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={save} noValidate>
        <fieldset disabled={!manages} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <TextField
            label={t('console.col_key')}
            help={t('console.plan_key_help')}
            value={draft.key}
            onChange={(event) => change({ key: event.target.value })}
            readOnly={plan !== undefined}
            error={errors.key}
            required
          />
          <TextField
            label={t('console.name_en')}
            value={draft.nameEn}
            onChange={(event) => change({ nameEn: event.target.value })}
            error={errors['name.en']}
            required
          />
          <TextField
            label={t('console.name_hi')}
            lang="hi"
            value={draft.nameHi}
            onChange={(event) => change({ nameHi: event.target.value })}
            error={errors['name.hi']}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label={t('console.price_month')}
              numeric
              inputMode="decimal"
              value={draft.priceMonth}
              onChange={(event) => change({ priceMonth: event.target.value })}
              error={errors.priceMonth}
              required
            />
            <TextField
              label={t('console.price_year')}
              numeric
              inputMode="decimal"
              value={draft.priceYear}
              onChange={(event) => change({ priceYear: event.target.value })}
              error={errors.priceYear}
              required
            />
          </div>
          <ChoiceGroup legend={t('console.plan_modules')} error={errors.modules}>
            {MODULE_KEYS.map((key) => (
              <Checkbox
                key={key}
                label={moduleName(key, t)}
                {...(key === 'core'
                  ? { detail: t('admin.module_always_on') }
                  : AVAILABLE_MODULES.includes(key)
                    ? {}
                    : { detail: t('admin.module_coming') })}
                checked={draft.modules.includes(key)}
                disabled={key === 'core'}
                onChange={(event) => toggle(key, event.target.checked)}
              />
            ))}
          </ChoiceGroup>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label={t('console.people_limit')}
              help={t('console.limit_blank_help')}
              numeric
              inputMode="numeric"
              value={draft.users}
              onChange={(event) => change({ users: event.target.value.replace(/\D/g, '') })}
              error={errors['limits.users']}
            />
            <TextField
              label={t('console.storage_limit')}
              help={t('console.limit_blank_help')}
              numeric
              inputMode="numeric"
              value={draft.storageGb}
              onChange={(event) => change({ storageGb: event.target.value.replace(/\D/g, '') })}
              error={errors['limits.storageGb']}
            />
          </div>
          <ChoiceGroup legend={t('console.addons')} error={errors.addons}>
            <div className="flex flex-col gap-4">
              {draft.addons.map((addon, index) => (
                <div
                  key={addon.row}
                  className="grid grid-cols-1 items-end gap-3 border-b border-[var(--border)] pb-4 sm:grid-cols-2"
                >
                  <TextField
                    label={t('console.addon_key')}
                    value={addon.key}
                    onChange={(event) => changeAddon(addon.row, { key: event.target.value })}
                    error={errors[`addons.${index}.key`]}
                  />
                  <TextField
                    label={t('console.addon_price')}
                    numeric
                    inputMode="decimal"
                    value={addon.price}
                    onChange={(event) => changeAddon(addon.row, { price: event.target.value })}
                    error={errors[`addons.${index}.price`]}
                  />
                  <TextField
                    label={t('console.name_en')}
                    value={addon.nameEn}
                    onChange={(event) => changeAddon(addon.row, { nameEn: event.target.value })}
                    error={errors[`addons.${index}.name.en`]}
                  />
                  <TextField
                    label={t('console.name_hi')}
                    lang="hi"
                    value={addon.nameHi}
                    onChange={(event) => changeAddon(addon.row, { nameHi: event.target.value })}
                    error={errors[`addons.${index}.name.hi`]}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    icon={<X size={16} aria-hidden="true" />}
                    onClick={() =>
                      change({ addons: draft.addons.filter((each) => each.row !== addon.row) })
                    }
                  >
                    {t('console.addon_remove')}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={() =>
                  change({
                    addons: [
                      ...draft.addons,
                      { row: newId(), key: '', nameEn: '', nameHi: '', price: '' },
                    ],
                  })
                }
              >
                {t('console.addon_add')}
              </Button>
            </div>
          </ChoiceGroup>
          <Checkbox
            label={t('console.plan_active')}
            detail={t('console.plan_active_help')}
            checked={draft.active}
            onChange={(event) => change({ active: event.target.checked })}
          />
        </fieldset>
        {failure ? (
          <p className="ks-help error" role="alert">
            {failure}
          </p>
        ) : null}
        {manages ? (
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            busy={busy}
            disabled={
              !draft.key.trim() ||
              !draft.nameEn.trim() ||
              !draft.nameHi.trim() ||
              !draft.priceMonth.trim() ||
              !draft.priceYear.trim()
            }
          >
            {t(plan ? 'console.save_plan' : 'console.add_plan')}
          </Button>
        ) : null}
      </form>
    </Card>
  );
}
