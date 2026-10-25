import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * A QR code an authenticator app scans (decisions D88 and D91), drawn as SVG from the brand's tokens: dark
 * modules on a light ground in every theme, as many readers can't read an inverted code, with the
 * four-module quiet zone the standard asks for.
 */
export function QrCode({
  value,
  label,
  size = 208,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { count, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const modules = code.getModuleCount();
    let d = '';
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { count: modules + 8, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      style={{ background: 'var(--on-brand)', borderRadius: 'var(--radius-md)' }}
    >
      <path d={path} fill="var(--brand-forest)" />
    </svg>
  );
}
