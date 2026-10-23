import type { ErrorDetail } from '@thelamp/shared';
import agri from '../agri/template.json' with { type: 'json' };
import generic from '../generic/template.json' with { type: 'json' };
import type { Template } from './schema/template';
import { validateTemplate } from './validate';

/**
 * Every template file, by key; a template's key is its folder's name. The files are imported,
 * not read from disk, so a bundled app carries them.
 */
const FILES: Readonly<Record<string, unknown>> = { agri, generic };

export const TEMPLATE_KEYS: readonly string[] = Object.keys(FILES).sort();

/** A template that doesn't exist or doesn't validate. */
export class TemplateError extends Error {
  readonly issues: readonly ErrorDetail[];

  constructor(key: string, issues: readonly ErrorDetail[]) {
    const lines = issues.map(({ path, issue }) => `  ${path || '(template)'}: ${issue}`);
    super(`Template \`${key}\` is not valid:\n${lines.join('\n')}`);
    this.name = 'TemplateError';
    this.issues = issues;
  }
}

/** The template with this key, validated and with its defaults filled in. */
export function loadTemplate(key: string): Template {
  if (!Object.hasOwn(FILES, key)) {
    throw new TemplateError(key, [{ path: '', issue: `There is no template \`${key}\`` }]);
  }
  const result = validateTemplate(FILES[key]);
  if (!result.ok) throw new TemplateError(key, result.issues);
  if (result.template.key !== key) {
    throw new TemplateError(key, [
      { path: 'key', issue: `The key must be its folder's name, \`${key}\`` },
    ]);
  }
  return result.template;
}
