import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';

/** The product's name (decision D1); `pnpm rename` keeps the default in step with product.json. */
export const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME ?? 'The Lamp';

/** The product mark and name. The mark keeps the product's own colour, never a tenant's. */
export function Brand() {
  return (
    <span className="flex items-center gap-3">
      <img src={markUrl} alt="" width={32} height={32} className="rounded-[var(--radius-sm)]" />
      <span className="heading-md">{PRODUCT_NAME}</span>
    </span>
  );
}
