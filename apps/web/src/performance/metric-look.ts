import type { PerformanceMetric } from '@thelamp/shared';
import type { Hue } from '@thelamp/ui-web';
import { CircleCheck, Clock, type LucideIcon, Package, Target, Wallet } from 'lucide-react';

/**
 * How a metric's tile looks, from its unit alone, so every tenant's metrics take a look without
 * naming their industry: counts a check in sage, amounts a wallet in butter, shares a target in
 * sky, times a clock in lilac and quantities a package in peach (decision D104).
 */
const LOOKS: Record<PerformanceMetric['unit'], { icon: LucideIcon; hue: Hue }> = {
  count: { icon: CircleCheck, hue: 'sage' },
  currency: { icon: Wallet, hue: 'butter' },
  percent: { icon: Target, hue: 'sky' },
  duration: { icon: Clock, hue: 'lilac' },
  quantity: { icon: Package, hue: 'peach' },
};

export function metricLook(metric: Pick<PerformanceMetric, 'unit'>) {
  return LOOKS[metric.unit];
}
