import { Logger } from '@nestjs/common';
import type { Config } from '../../config';

/** What the gateway says of a charge: taken, with its reference, or refused and why. */
export type ChargeResult = { ok: true; providerRef: string } | { ok: false; reason: string };

/**
 * The billing interface (spec 9.6, decision D90): automatic payment through a mandate the
 * tenant authorises once, then a charge for each invoice. Razorpay goes behind it once its
 * account exists; until then `off` takes no payments, and invoices are paid by transfer and
 * recorded in the console.
 */
export abstract class PaymentGateway {
  /** Whether the gateway takes payments at all. */
  abstract readonly enabled: boolean;
  /**
   * Starts a mandate for a tenant: its reference, and the page where its billing contact
   * authorises it; no page when the gateway needs no authorisation, so the mandate is active.
   */
  abstract authorise(tenantId: string, email: string): Promise<{ ref: string; url: string | null }>;
  /** Charges an invoice's total, a decimal string in rupees, against an authorised mandate. */
  abstract charge(input: {
    mandateRef: string;
    invoiceId: string;
    number: string;
    amount: string;
  }): Promise<ChargeResult>;
}

/** No gateway yet: no mandates, no charges. */
export class OffGateway extends PaymentGateway {
  readonly enabled = false;

  authorise(): Promise<{ ref: string; url: string | null }> {
    return Promise.reject(new Error('No payment gateway is set up.'));
  }

  charge(): Promise<ChargeResult> {
    return Promise.resolve({ ok: false, reason: 'No payment gateway is set up.' });
  }
}

/** Locally and on the demo: every mandate is authorised at once and every charge goes through. */
export class ConsoleGateway extends PaymentGateway {
  readonly enabled = true;
  private readonly logger = new Logger('ConsoleGateway');

  authorise(tenantId: string): Promise<{ ref: string; url: string | null }> {
    this.logger.log(`Mandate authorised for tenant ${tenantId}`);
    return Promise.resolve({ ref: `console-mandate-${tenantId}`, url: null });
  }

  charge(input: { invoiceId: string; number: string; amount: string }): Promise<ChargeResult> {
    this.logger.log(`Charged ₹${input.amount} for invoice ${input.number}`);
    return Promise.resolve({ ok: true, providerRef: `console-${input.invoiceId}` });
  }
}

/** For tests: mandates authorise at once; charges go through until `refuse` says otherwise. */
export class MemoryGateway extends PaymentGateway {
  readonly enabled = true;
  readonly charges: { invoiceId: string; number: string; amount: string }[] = [];
  /** The reason the next charges are refused with, while set. */
  refuse: string | null = null;

  authorise(tenantId: string): Promise<{ ref: string; url: string | null }> {
    return Promise.resolve({ ref: `memory-mandate-${tenantId}`, url: null });
  }

  charge(input: { invoiceId: string; number: string; amount: string }): Promise<ChargeResult> {
    this.charges.push({ invoiceId: input.invoiceId, number: input.number, amount: input.amount });
    if (this.refuse) return Promise.resolve({ ok: false, reason: this.refuse });
    return Promise.resolve({ ok: true, providerRef: `memory-${input.invoiceId}` });
  }
}

export function paymentGateway(config: Config): PaymentGateway {
  switch (config.PAYMENT_PROVIDER) {
    case 'console':
      return new ConsoleGateway();
    case 'memory':
      return new MemoryGateway();
    case 'off':
      return new OffGateway();
  }
}
