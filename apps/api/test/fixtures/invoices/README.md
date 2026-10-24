# Invoices for phase 2's exit check

Phase 2 ends when order totals reconcile with three real invoices to the paisa (spec 15, decision D86). `test/phase-2-exit.int.test.ts` places an order for each invoice here, with the invoice's own prices, discounts and tax rates, and compares the order's taxable amount, tax, CGST, SGST and total with the invoice's. Any difference fails the test and names the invoice and the amount.

`sample-fictional.json` is made from fixtures FX-07 and FX-08, so the check runs before the real invoices arrive.

## Adding a real invoice

Put it in `private/`, which git ignores, so customer documents stay off the repository. Names can be left out; prices, discounts, tax rates, quantities and totals must be exactly as printed.

```json
{
  "label": "Invoice 1 from the pilot customer",
  "lines": [
    { "item": "Item code", "unit": "case", "perUnit": "12", "quantity": "2", "price": "400.00", "discount": "10", "taxRate": "18" }
  ],
  "totals": { "taxable": "8640.00", "tax": "1555.20", "cgst": "777.60", "sgst": "777.60", "total": "10195.20" }
}
```

- `price` is per base unit (a pack, a kg), before the discount; `discount` and `taxRate` are percentages.
- `unit` is the unit ordered, `pack` or `case` as the agri template has them, and `perUnit` how many packs it holds; for single packs, use `"unit": "pack", "perUnit": "1"`.
- `totals` are the invoice's, before any round-off line.

Then run `pnpm --filter @thelamp/api exec vitest run -c vitest.int.config.ts test/phase-2-exit.int.test.ts`.
