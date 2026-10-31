import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IMPORT_TARGETS, newId } from '@thelamp/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** An example file for each import target (phase 4 step A2, decision D111). */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const get = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

/** Each sheet's rows as text. */
async function sheets(payload: Buffer): Promise<{ name: string; rows: string[][] }[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(payload as unknown as ArrayBuffer);
  return workbook.worksheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) =>
      rows.push((row.values as unknown[]).slice(1).map((value) => String(value ?? ''))),
    );
    return { name: sheet.name, rows };
  });
}

async function admin(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  const token = (await world.signIn(phone)).accessToken;
  await world.territory(tenantId, `T-${newId().slice(-6)}`);
  return { tenantId, token };
}

describe('import examples (D111)', () => {
  it('gives every target a file to fill, an example and what each column holds', async () => {
    const t = await admin('Example Co');
    const targets = [...IMPORT_TARGETS, 'accounts:customer'];
    for (const target of targets) {
      const reply = await get(t.token, `/v1/imports/example?target=${target}`);
      expect(reply.statusCode, `${target}: ${reply.body}`).toBe(200);
      expect(reply.headers['content-disposition']).toBe(
        `attachment; filename="example-${target.replace(':', '-')}.xlsx"`,
      );
      const [rows, example, columns] = await sheets(reply.rawPayload);
      expect([rows?.name, example?.name, columns?.name]).toEqual([
        'Your rows',
        'Example',
        'Columns',
      ]);
      // The sheet an import reads holds headings alone, so an unchanged file imports nothing.
      expect(rows!.rows).toHaveLength(1);
      const headings = rows!.rows[0]!;
      expect(example!.rows[0]).toEqual(headings);
      expect(example!.rows.length, target).toBeGreaterThanOrEqual(3);
      // One line a column, and every required column filled in every example row.
      expect(columns!.rows.slice(1).map((row) => row[0])).toEqual(headings);
      const required = columns!.rows
        .slice(1)
        .flatMap((row, index) => (row[2] === 'Yes' ? [index] : []));
      for (const row of example!.rows.slice(1)) {
        for (const index of required) {
          expect(row[index], `${target}: ${headings[index]}`).not.toBe('');
        }
      }
    }
  });

  it('names the columns in the reader’s language', async () => {
    const t = await admin('Hindi Example Co');
    const reply = await get(t.token, '/v1/imports/example?target=users&locale=hi');
    const [rows, , columns] = await sheets(reply.rawPayload);
    expect(rows!.name).toBe('आपकी पंक्तियाँ');
    expect(columns!.rows[1]).toEqual(['Employee code', 'कर्मचारी कोड', 'हाँ']);
  });

  it('asks for the target’s own permission, as starting an import does', async () => {
    const tenantId = await world.tenant('Field Example Co');
    const phone = newPhone();
    await world.user(tenantId, { phone, designation: 'executive' });
    const field = (await world.signIn(phone, newDevice())).accessToken;
    expect((await get(field, '/v1/imports/example?target=users')).statusCode).toBe(403);
    const t = await admin('Bad Example Co');
    expect((await get(t.token, '/v1/imports/example?target=nothing')).statusCode).toBe(400);
  });
});
