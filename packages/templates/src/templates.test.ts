import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { loadTemplate, TEMPLATE_KEYS, TemplateError } from './registry';

const root = new URL('..', import.meta.url);
const read = (path: string): object => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

/** The folders that hold a template.json. */
const folders = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => readdirSync(new URL(`${entry.name}/`, root)).includes('template.json'))
  .map((entry) => entry.name)
  .sort();

describe('the template registry', () => {
  it('holds every template folder', () => {
    expect(TEMPLATE_KEYS).toEqual(folders);
    // Phase 0 exits with both of its templates validating (spec 15).
    expect(TEMPLATE_KEYS.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a key it does not hold', () => {
    expect(() => loadTemplate('nothing')).toThrow(TemplateError);
  });
});

describe.each(folders)('the %s template', (key) => {
  it('validates, with every reference resolved', () => {
    const template = loadTemplate(key);
    expect(template.key).toBe(key);
    expect(template.version).toBeGreaterThanOrEqual(1);
  });

  it('matches schema.json, the schema editors use', () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(read('schema.json'));
    const file = read(`${key}/template.json`);
    expect(validate(file), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(file).toMatchObject({ $schema: '../schema.json' });
  });
});
