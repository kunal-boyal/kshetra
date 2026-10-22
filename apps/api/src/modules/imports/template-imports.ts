import type { Template } from '@kshetra/templates';

/** A template's import aliases by target: `users`, `items`, and `accounts:<type>` for each type. */
export function templateImports(template: Template) {
  const { users, accounts, items } = template.imports;
  return {
    ...(users ? { users } : {}),
    ...(items ? { items } : {}),
    ...Object.fromEntries(
      Object.entries(accounts ?? {}).map(([type, target]) => [`accounts:${type}`, target]),
    ),
  };
}
