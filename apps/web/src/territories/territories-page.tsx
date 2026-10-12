import { TerritoryListResult, TerritoryResult } from '@kshetra/shared';
import {
  Button,
  Checkbox,
  type Column,
  DataTable,
  EmptyState,
  Icon,
  SelectField,
  StatusBadge,
  TextField,
} from '@kshetra/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileSpreadsheet, MapPinned, Pencil, Plus, Power } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../context';
import { errorMessage, useLanguage } from '../i18n';
import { read, useAccess, write } from '../people/data';
import { fieldErrors, PageHeader, Section } from '../people/shared';

type Territory = TerritoryResult;

/** The whole tree with the tenant's levels; pickers elsewhere read the same query's nodes. */
function useTree() {
  const { client } = useApp();
  return useQuery({
    queryKey: ['territories', 'tree'],
    queryFn: () => read(client, '/v1/territories', TerritoryListResult),
  });
}

/** Nodes in tree order, each under its parent, siblings by name. */
function inTreeOrder(nodes: readonly Territory[]): Territory[] {
  const children = new Map<string | null, Territory[]>();
  for (const node of nodes) {
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const known = new Set(nodes.map((node) => node.id));
  const ordered: Territory[] = [];
  const visit = (node: Territory) => {
    ordered.push(node);
    for (const child of (children.get(node.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      visit(child);
    }
  };
  // The top, and any node whose parent this view leaves out.
  const roots = nodes.filter((node) => node.parentId === null || !known.has(node.parentId));
  for (const root of roots.sort((a, b) => a.name.localeCompare(b.name))) visit(root);
  return ordered;
}

type Editing = { kind: 'add'; parent: Territory | null } | { kind: 'edit'; node: Territory };

/**
 * Territories (M4): the tenant's geography as a tree, one level under another. A territory keeps
 * its level, so it moves only to another parent at the level above it; switching one off needs
 * its children and people moved first.
 */
export function TerritoriesPage() {
  const { client } = useApp();
  const { t, locale } = useLanguage();
  const access = useAccess();
  const queryClient = useQueryClient();
  const tree = useTree();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState<string>();
  const manage = access.can('territory.manage');
  const levels = tree.data?.levels ?? [];
  const levelName = (level: number) =>
    levels.find((entry) => entry.level === level)?.name[locale].one ?? String(level);
  const rows = useMemo(
    () => inTreeOrder((tree.data?.items ?? []).filter((node) => showInactive || node.active)),
    [tree.data, showInactive],
  );

  async function refresh(message: string) {
    setEditing(null);
    setDone(message);
    await queryClient.invalidateQueries({ queryKey: ['territories'] });
  }

  async function switchActive(node: Territory) {
    setError(undefined);
    setDone(undefined);
    try {
      await write(client, 'PATCH', `/v1/territories/${node.id}`, TerritoryResult, {
        active: !node.active,
      });
      await refresh(
        t(node.active ? 'territories.done_off' : 'territories.done_on', { name: node.name }),
      );
    } catch (caught) {
      setError(caught);
    }
  }

  const columns: Column<Territory>[] = [
    {
      key: 'name',
      header: t('territories.name'),
      render: (node) => (
        // Each level sits one step further in, so the table reads as the tree.
        <span
          className="flex flex-col"
          style={{ paddingInlineStart: `calc(var(--space-6) * ${node.level - 1})` }}
        >
          <span className="font-semibold">{node.name}</span>
          <span className="ks-muted">{levelName(node.level)}</span>
        </span>
      ),
    },
    { key: 'code', header: t('territories.code'), render: (node) => <code>{node.code}</code> },
    {
      key: 'status',
      header: t('territories.status'),
      render: (node) => (
        <StatusBadge variant={node.active ? 'success' : 'neutral'}>
          {t(node.active ? 'territories.active' : 'territories.inactive')}
        </StatusBadge>
      ),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t('territories.actions'),
            render: (node: Territory) => (
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Pencil} size="sm" />}
                  aria-label={t('territories.edit_named', { name: node.name })}
                  onClick={() => setEditing({ kind: 'edit', node })}
                >
                  {t('common.edit')}
                </Button>
                {node.active && node.level < levels.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={Plus} size="sm" />}
                    aria-label={t('territories.add_under', {
                      name: node.name,
                      level: levelName(node.level + 1),
                    })}
                    onClick={() => setEditing({ kind: 'add', parent: node })}
                  >
                    {t('territories.add_child', { level: levelName(node.level + 1) })}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={Power} size="sm" />}
                  aria-label={t(node.active ? 'territories.off_named' : 'territories.on_named', {
                    name: node.name,
                  })}
                  onClick={() => void switchActive(node)}
                >
                  {t(node.active ? 'territories.switch_off' : 'territories.switch_on')}
                </Button>
              </span>
            ),
          } satisfies Column<Territory>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('territories.title')} intro={t('territories.intro')}>
        {access.can('import.run') && manage ? (
          <Link to="/imports" className="ks-btn secondary">
            <Icon icon={FileSpreadsheet} />
            {t('territories.import')}
          </Link>
        ) : null}
        {manage && levels.length > 0 ? (
          <Button
            variant="primary"
            icon={<Icon icon={Plus} />}
            onClick={() => setEditing({ kind: 'add', parent: null })}
          >
            {t('territories.add_child', { level: levelName(1) })}
          </Button>
        ) : null}
      </PageHeader>

      {editing ? (
        <TerritoryForm
          key={editing.kind === 'add' ? `add-${editing.parent?.id ?? 'top'}` : editing.node.id}
          editing={editing}
          nodes={tree.data?.items ?? []}
          levelName={levelName}
          onSaved={(name) => void refresh(t('territories.saved', { name }))}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {done ? <p role="status">{done}</p> : null}
      {error !== undefined ? (
        <p className="ks-help error" role="alert">
          {fieldErrors(error).active ?? errorMessage(error, t)}
        </p>
      ) : null}

      <Checkbox
        label={t('territories.show_inactive')}
        checked={showInactive}
        onChange={(event) => setShowInactive(event.target.checked)}
      />

      {tree.isError ? (
        <p className="ks-help error" role="alert">
          {errorMessage(tree.error, t)}
        </p>
      ) : tree.isPending ? (
        <p className="ks-muted">{t('common.loading')}</p>
      ) : (
        <DataTable
          caption={t('territories.caption')}
          columns={columns}
          rows={rows}
          rowKey={(node) => node.id}
          empty={
            <EmptyState icon={<Icon icon={MapPinned} />} title={t('territories.empty_title')}>
              {t('territories.empty_body')}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}

/** Adds a territory under a parent, or renames, recodes or moves one within its level. */
function TerritoryForm({
  editing,
  nodes,
  levelName,
  onSaved,
  onCancel,
}: {
  editing: Editing;
  nodes: readonly Territory[];
  levelName: (level: number) => string;
  onSaved: (name: string) => void;
  onCancel: () => void;
}) {
  const { client } = useApp();
  const { t } = useLanguage();
  const node = editing.kind === 'edit' ? editing.node : null;
  const [name, setName] = useState(node?.name ?? '');
  const [code, setCode] = useState(node?.code ?? '');
  const [parentId, setParentId] = useState(node?.parentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const problems = fieldErrors(error);
  const level = node
    ? node.level
    : editing.kind === 'add' && editing.parent
      ? editing.parent.level + 1
      : 1;
  // A territory moves only under another active node of the level above.
  const parents = nodes
    .filter(
      (candidate) =>
        candidate.level === level - 1 && (candidate.active || candidate.id === parentId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = node
    ? t('territories.edit_named', { name: node.name })
    : editing.kind === 'add' && editing.parent
      ? t('territories.add_under', {
          name: editing.parent.name,
          level: levelName(editing.parent.level + 1),
        })
      : t('territories.add_child', { level: levelName(1) });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (node) {
        const changes = {
          ...(name.trim() !== node.name ? { name: name.trim() } : {}),
          ...(code.trim() !== node.code ? { code: code.trim() } : {}),
          ...(parentId && parentId !== node.parentId ? { parentId } : {}),
        };
        if (Object.keys(changes).length > 0) {
          await write(client, 'PATCH', `/v1/territories/${node.id}`, TerritoryResult, changes);
        }
      } else {
        await write(client, 'POST', '/v1/territories', TerritoryResult, {
          code: code.trim(),
          name: name.trim(),
          parentId: editing.kind === 'add' ? (editing.parent?.id ?? null) : null,
        });
      }
      onSaved(name.trim());
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }

  const shownBelow = Boolean(problems.name || problems.code || problems.parentId);
  return (
    <Section title={title}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <p className="ks-muted">{t('territories.level_is', { level: levelName(level) })}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('territories.name')}
            required
            maxLength={100}
            value={name}
            {...(problems.name ? { error: problems.name } : {})}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label={t('territories.code')}
            help={t('territories.code_help')}
            required
            maxLength={40}
            value={code}
            {...(problems.code ? { error: problems.code } : {})}
            onChange={(event) => setCode(event.target.value)}
          />
          {node && level > 1 ? (
            <SelectField
              label={t('territories.parent')}
              help={t('territories.move_help', { level: levelName(level - 1) })}
              value={parentId}
              options={parents.map((parent) => ({
                value: parent.id,
                label: `${parent.name} (${parent.code})`,
              }))}
              {...(problems.parentId ? { error: problems.parentId } : {})}
              onChange={(event) => setParentId(event.target.value)}
            />
          ) : null}
        </div>
        {error !== undefined && !shownBelow ? (
          <p className="ks-help error" role="alert">
            {errorMessage(error, t)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={busy}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Section>
  );
}
