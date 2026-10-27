import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';

/** The product's name (decision D1); `pnpm rename` keeps the default in step with product.json. */
export const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME ?? 'The Lamp';

export { markUrl };

/** The product mark and name, with the console's own label. */
export function Brand({ label }: { label: string }) {
  return (
    <span className="ks-rail-brand">
      <img src={markUrl} alt="" width={32} height={32} />
      <span>
        {PRODUCT_NAME}
        <span className="ks-rail-sub">{label}</span>
      </span>
    </span>
  );
}
