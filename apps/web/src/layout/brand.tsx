import { Link } from '@tanstack/react-router';
import markUrl from '@thelamp/design-tokens/assets/Logos/mark-small.svg?url';

/** The product's name (decision D1); `pnpm rename` keeps the default in step with product.json. */
export const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME ?? 'The Lamp';

/** The product mark and name, a way home. The mark keeps the product's own colour, never a tenant's. */
export function Brand() {
  return (
    <Link to="/" className="ks-rail-brand">
      <img src={markUrl} alt="" width={32} height={32} />
      <span>{PRODUCT_NAME}</span>
    </Link>
  );
}
