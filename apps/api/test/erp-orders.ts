import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { expect } from 'vitest';
import { newAddress, newDevice, newPhone, type World } from './support';

/**
 * An agri tenant for orders going out to the books (D129): a head, an ASM and an SME holding a
 * distributor, the items NEEM, UREA and KARANJ with a standard price list, and `order()`, which
 * places an order in cases and has the ASM and the head decide each line. Also used for stock
 * (decision D130).
 */
export async function orderingTenant(app: NestFastifyApplication, world: World, name: string) {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) =>
    app.inject({
      method,
      url,
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(body ? { payload: body } : {}),
    });
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { head: newPhone(), asm: newPhone(), sme: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  const asm = await world.user(tenantId, {
    phone: phones.asm,
    designation: 'asm',
    role: 'manager',
    managerId: head.id,
  });
  await world.user(tenantId, { phone: phones.sme, designation: 'sme', managerId: asm.id });
  const tokens = {
    head: (await world.signIn(phones.head)).accessToken,
    asm: (await world.signIn(phones.asm)).accessToken,
    sme: (await world.signIn(phones.sme, newDevice())).accessToken,
  };
  const marketCode = `M${newId().slice(-6).toUpperCase()}`;
  const market = await world.territory(tenantId, marketCode);
  const distributor = newId();
  const distributorCode = `D-${newId().slice(-6).toUpperCase()}`;
  const sme = (await call('GET', '/v1/me', tokens.sme)).json();
  const made = await call('POST', '/v1/accounts', tokens.head, {
    id: distributor,
    type: 'distributor',
    code: distributorCode,
    name: 'Kisan Traders',
    territoryId: market,
    slots: { asm: asm.id, sme: sme.userId },
  });
  expect(made.statusCode, made.body).toBe(201);
  const itemIds: Record<string, string> = {};
  for (const itemCode of ['NEEM', 'UREA', 'KARANJ']) {
    const id = newId();
    const saved = await call('PUT', `/v1/items/${id}`, tokens.head, {
      code: itemCode,
      name: `${itemCode} item`,
      productName: `${itemCode} product`,
      categoryName: null,
      packLabel: '500 ML',
      hsn: '3808',
      taxRate: '18',
      mrp: '450',
      baseUnit: 'pack',
      units: [{ key: 'case', factor: '12' }],
      measureType: 'L',
      measurePerBaseUnit: '0.5',
    });
    expect(saved.statusCode, saved.body).toBe(201);
    itemIds[itemCode] = id;
  }
  const list = newId();
  await call('PUT', `/v1/price-lists/${list}`, tokens.head, {
    name: 'Standard',
    scope: 'default',
    validFrom: '2026-01-01',
  });
  const { version } = (await call('GET', `/v1/price-lists/${list}`, tokens.head)).json();
  const prices: Record<string, { price: string; discount: string }> = {
    NEEM: { price: '400.00', discount: '10' },
    UREA: { price: '90.23', discount: '0' },
    KARANJ: { price: '50.00', discount: '0' },
  };
  const priced = await call('PUT', `/v1/price-lists/${list}/items`, tokens.head, {
    set: Object.entries(prices).map(([itemCode, entry]) => ({
      itemId: itemIds[itemCode],
      ...entry,
    })),
    version,
  });
  expect(priced.statusCode, priced.body).toBe(200);

  /** Places an order in cases, then the ASM and the head decide each line. */
  const order = async (lines: Record<string, string>, accepted: string[]) => {
    const id = newId();
    const placed = await call('POST', '/v1/orders', tokens.sme, {
      id,
      accountId: distributor,
      lines: Object.entries(lines).map(([itemCode, cases]) => ({
        itemId: itemIds[itemCode],
        unitKey: 'case',
        quantity: cases,
        quoted: { listId: list, ...prices[itemCode]!, taxRate: '18', factor: '12', scheme: null },
      })),
      free: [],
      fix: {
        location: { lat: 28.6315, lng: 77.2167 },
        accuracy: 12,
        mocked: false,
        capturedAt: new Date().toISOString(),
      },
      placedAt: new Date().toISOString(),
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const seen = (await call('GET', `/v1/orders/${id}`, tokens.asm)).json();
    await call('POST', `/v1/orders/${id}/decision`, tokens.asm, {
      decision: 'accept',
      version: seen.approval.version,
    });
    const atHead = (await call('GET', `/v1/orders/${id}`, tokens.head)).json();
    const decided = await call('POST', `/v1/orders/${id}/line-decisions`, tokens.head, {
      lines: atHead.lines.map((line: { id: string; item: { code: string } }) =>
        accepted.includes(line.item.code)
          ? { lineId: line.id, decision: 'accepted' }
          : { lineId: line.id, decision: 'rejected', reason: 'no_stock' },
      ),
      version: atHead.approval.version,
    });
    expect(decided.statusCode, decided.body).toBe(200);
    return decided.json() as { id: string; number: number; status: string };
  };
  return {
    tenantId,
    admin: tokens.head,
    marketCode,
    distributor,
    distributorCode,
    itemIds,
    order,
  };
}
