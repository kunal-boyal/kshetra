import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AppError, type ImportProblem } from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import type { TenantTx } from '../../platform/database';
import { cellText, cellYesNo, isEmptyCell } from '../imports/reading';
import {
  type ImportContext,
  ImportRefused,
  type ImportRow,
  type ImportTargetSource,
  ImportTargets,
  type TargetField,
  checked,
} from '../imports/targets';
import { TerritoriesService } from './territories.service';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

interface Planned {
  row: number;
  code: string;
  name: string;
  parentCode: string | null;
  active: boolean;
  level: number;
  /** The existing node with this code, if any. */
  id: string | null;
}

/**
 * Territory imports (M4, M19): code, name, the parent's code (blank for the top) and the level,
 * by number, key or name. A code already in the tree updates that node; a node keeps its level,
 * so it moves only to a parent at the same level as before. Parents may come later in the file.
 */
@Injectable()
export class TerritoriesImport implements ImportTargetSource, OnModuleInit {
  readonly name = 'territories';
  readonly permission = 'territory.manage';

  constructor(
    private readonly targets: ImportTargets,
    private readonly territories: TerritoriesService,
  ) {}

  onModuleInit(): void {
    this.targets.register(this);
  }

  async fields(): Promise<TargetField[]> {
    return [
      { key: 'code', names: ['Code', 'Territory code'], required: true },
      { key: 'name', names: ['Name', 'Territory name', 'Territory'], required: true },
      { key: 'parent_code', names: ['Parent', 'Parent code', 'Parent territory'], required: false },
      { key: 'level', names: ['Level', 'Type'], required: false },
      { key: 'active', names: ['Active', 'Status'], required: false },
    ];
  }

  /** Every row's intent, with every problem found without writing. */
  private async plan(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const tenantId = context.access.tenantId;
    const problems: ImportProblem[] = [];
    const problem = (row: number, field: string | null, issue: string) =>
      problems.push({ row, field, issue });
    const existing = new Map(
      (await this.territories.list(tx, tenantId, {})).map((node) => [
        node.code.toLowerCase(),
        node,
      ]),
    );
    const levels = await this.territories.levels(tx, tenantId);
    const levelOf = (text: string): number | null => {
      if (/^\d+$/.test(text)) return Number(text);
      const lower = text.toLowerCase();
      return (
        levels.find(
          (level) =>
            level.key === lower ||
            [level.name.en.one, level.name.en.other, level.name.hi.one, level.name.hi.other].some(
              (name) => name.toLowerCase() === lower,
            ),
        )?.level ?? null
      );
    };
    const empty = (cell: ImportRow['cells'][string] | undefined) =>
      isEmptyCell(cell, context.emptyValues);

    const seen = new Map<string, number[]>();
    for (const { row, cells } of rows) {
      const code = cellText(cells.code).toLowerCase();
      if (code) seen.set(code, [...(seen.get(code) ?? []), row]);
    }

    const planned = new Map<string, Planned & { wantedLevel: number | null }>();
    for (const { row, cells } of rows) {
      const code = cellText(cells.code);
      const name = cellText(cells.name);
      if (!code) problem(row, 'code', 'Fill in the code');
      else if (!CODE.test(code))
        problem(row, 'code', 'Use up to 40 letters, digits, dots, dashes, slashes or underscores');
      else if ((seen.get(code.toLowerCase())?.length ?? 0) > 1) {
        problem(
          row,
          'code',
          `This code appears more than once, in rows ${seen.get(code.toLowerCase())!.join(', ')}`,
        );
      }
      if (!name) problem(row, 'name', 'Fill in the name');
      else if (name.length > 100) problem(row, 'name', 'Use at most 100 characters');
      const active = empty(cells.active) ? true : cellYesNo(cells.active);
      if (active === null) problem(row, 'active', 'Write yes or no');
      let wantedLevel: number | null = null;
      if (!empty(cells.level)) {
        wantedLevel = levelOf(cellText(cells.level));
        if (wantedLevel === null)
          problem(row, 'level', `There is no level called ${cellText(cells.level)}`);
      }
      const parentCode = empty(cells.parent_code) ? null : cellText(cells.parent_code);
      if (parentCode && parentCode.toLowerCase() === code.toLowerCase()) {
        problem(row, 'parent_code', 'A territory cannot be its own parent');
      }
      if (code && !planned.has(code.toLowerCase())) {
        planned.set(code.toLowerCase(), {
          row,
          code,
          name,
          parentCode,
          active: active ?? true,
          level: 0,
          id: existing.get(code.toLowerCase())?.id ?? null,
          wantedLevel,
        });
      }
    }

    // Levels follow parents, through the file and the tree: the top is level 1.
    const resolving = new Set<string>();
    const levelFor = (code: string): number | null => {
      const key = code.toLowerCase();
      const entry = planned.get(key);
      if (!entry) return existing.get(key)?.level ?? null;
      if (entry.level > 0) return entry.level;
      if (resolving.has(key)) return null;
      resolving.add(key);
      let level: number | null = 1;
      if (entry.parentCode) {
        const parent = levelFor(entry.parentCode);
        level = parent === null ? null : parent + 1;
      }
      resolving.delete(key);
      if (level !== null) entry.level = level;
      return level;
    };
    for (const entry of planned.values()) {
      if (entry.parentCode) {
        const parentKey = entry.parentCode.toLowerCase();
        if (!planned.has(parentKey) && !existing.has(parentKey)) {
          problem(
            entry.row,
            'parent_code',
            `There is no territory with the code ${entry.parentCode}`,
          );
          continue;
        }
      }
      const level = levelFor(entry.code);
      if (level === null) {
        problem(entry.row, 'parent_code', 'These parents go round in a loop');
        continue;
      }
      if (level > levels.length) {
        problem(entry.row, 'level', 'The geography has no level this deep');
      } else if (entry.wantedLevel !== null && entry.wantedLevel !== level) {
        problem(entry.row, 'level', `Under this parent, a territory is level ${level}`);
      }
      const current = existing.get(entry.code.toLowerCase());
      if (current && current.level !== level) {
        problem(
          entry.row,
          'parent_code',
          `A territory keeps its level; this one is level ${current.level}`,
        );
      }
    }
    return { problems, planned: [...planned.values()] };
  }

  async check(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    return checked(
      problems,
      planned.map((entry) => ({ existing: entry.id !== null })),
    );
  }

  async commit(tx: TenantTx, rows: readonly ImportRow[], context: ImportContext) {
    const { problems, planned } = await this.plan(tx, rows, context);
    if (problems.length > 0) throw new ImportRefused(problems);
    const tenantId = context.access.tenantId;
    const actor = userActor(context.access);
    const ids = new Map(
      (await this.territories.list(tx, tenantId, {})).map((node) => [
        node.code.toLowerCase(),
        node.id,
      ]),
    );
    let created = 0;
    let updated = 0;
    // Parents first, so every new node has its parent in place.
    for (const entry of [...planned].sort((a, b) => a.level - b.level)) {
      const parentId = entry.parentCode ? (ids.get(entry.parentCode.toLowerCase()) ?? null) : null;
      try {
        if (entry.id) {
          const before = await this.territories.get(tx, tenantId, entry.id);
          const after = await this.territories.change(tx, tenantId, actor, entry.id, {
            name: entry.name,
            ...(parentId ? { parentId } : {}),
            active: entry.active,
          });
          if (JSON.stringify(before) !== JSON.stringify(after)) updated += 1;
        } else {
          const node = await this.territories.add(tx, tenantId, actor, {
            code: entry.code,
            name: entry.name,
            parentId,
          });
          ids.set(entry.code.toLowerCase(), node.id);
          if (!entry.active) {
            await this.territories.change(tx, tenantId, actor, node.id, { active: false });
          }
          created += 1;
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        throw new ImportRefused([
          {
            row: entry.row,
            field: error.details?.[0]?.path ?? null,
            issue: error.details?.[0]?.issue ?? error.message,
          },
        ]);
      }
    }
    return { created, updated };
  }
}
