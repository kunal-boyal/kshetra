/**
 * Home layouts (M18, decision D122): the checks a role's cards pass before they are kept, as
 * configuration is checked (decision D65): every metric and level a card names exists, and the
 * standard Home's cards appear once each.
 */
import { type ErrorDetail, issueAt } from './errors';
import type { DashboardCard } from './schemas/dashboard';

/** What the checks need of a metric: whether it is worked out, and whether its days add up. */
export interface LayoutMetric {
  key: string;
  available: boolean;
  additive: boolean;
}

/**
 * The problems with a layout, each at its card's path. A trend needs metrics whose days add up; a
 * breakdown by territory needs one whose people add up, and a level that exists.
 */
export function dashboardLayoutIssues(
  cards: readonly DashboardCard[],
  metrics: readonly LayoutMetric[],
  levels: readonly string[],
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const seen = new Set<string>();
  const known = (path: PropertyKey[], key: string) => {
    const metric = byKey.get(key);
    if (!metric) issues.push(issueAt(path, `There is no metric ${key}`));
    else if (!metric.available) issues.push(issueAt(path, `${key} isn't worked out yet`));
    return metric;
  };
  cards.forEach((card, index) => {
    switch (card.kind) {
      case 'tiles':
      case 'trend': {
        const repeated = card.metrics.find((key, at) => card.metrics.indexOf(key) !== at);
        if (repeated)
          issues.push(issueAt(['cards', index, 'metrics'], `${repeated} is named twice`));
        card.metrics.forEach((key, at) => {
          const metric = known(['cards', index, 'metrics', at], key);
          if (card.kind === 'trend' && metric?.available && !metric.additive) {
            issues.push(
              issueAt(['cards', index, 'metrics', at], `${key} doesn't add up day by day`),
            );
          }
        });
        return;
      }
      case 'breakdown': {
        const metric = known(['cards', index, 'metric'], card.metric);
        if (card.by === 'territory') {
          if (!card.level) issues.push(issueAt(['cards', index, 'level'], 'Choose a level'));
          else if (!levels.includes(card.level)) {
            issues.push(issueAt(['cards', index, 'level'], `There is no level ${card.level}`));
          }
          if (metric?.available && !metric.additive) {
            issues.push(
              issueAt(['cards', index, 'metric'], `${card.metric} doesn't add up across people`),
            );
          }
        } else if (card.level) {
          issues.push(issueAt(['cards', index, 'level'], 'Only a territory breakdown has a level'));
        }
        return;
      }
      default:
        if (seen.has(card.kind))
          issues.push(issueAt(['cards', index], 'This card is there already'));
        seen.add(card.kind);
    }
  });
  return issues;
}
