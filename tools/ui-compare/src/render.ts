/**
 * Draws a prototype artboard (a `.dc.html` file of the claude.ai Design canvas) as plain DOM, so
 * it can be screenshot beside the built screen. It follows the format's rules
 * (artifact-type/reference/format.md): `{{ path }}` holes are dotted lookups, `<sc-for>` repeats,
 * `<sc-if>` shows when truthy, `<dc-import name="X">` mounts `X.dc.html` with its other attributes
 * as camel-cased props, and the logic class's `renderVals()` gives the values. Event handlers are
 * dropped: a screenshot needs none. Runs in the browser, and in jsdom for its tests.
 */

export type Scope = Record<string, unknown>;

/** Reads a file of the prototype by name, such as `WebRail.dc.html`. */
export type Loader = (file: string) => Promise<string>;

const HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;

/** A dotted path in the scope, or a literal (`true`, `null`, a number). */
export function lookup(scope: Scope, path: string): unknown {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  let value: unknown = scope;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Text with each hole replaced by its value; a missing value leaves nothing. */
export function interpolate(text: string, scope: Scope): string {
  return text.replace(HOLE, (_, path: string) => {
    const value = lookup(scope, path);
    return value === null || value === undefined || typeof value === 'function'
      ? ''
      : String(value);
  });
}

/** An attribute's value: the raw value when the attribute is one hole, else interpolated text. */
function valueOf(raw: string, scope: Scope): unknown {
  const whole = WHOLE.exec(raw);
  return whole ? lookup(scope, whole[1]!) : interpolate(raw, scope);
}

class DCLogic {
  props: Scope;
  state: Scope = {};
  constructor(props: Scope) {
    this.props = props;
  }
  setState(next: Scope) {
    Object.assign(this.state, next);
  }
  forceUpdate() {}
}

interface Design {
  /** The artboard's template: the `<x-dc>` fragment without its helmet. */
  template: Node[];
  helmet: string;
  defaults: Scope;
  values: (props: Scope) => Scope;
}

/**
 * Parses a `.dc.html` file. `<sc-for>` and `<sc-if>` become `<template>`s first, since an HTML
 * parser moves unknown tags out of tables, where the prototype often loops over rows.
 */
function parse(html: string): Design {
  const safe = html
    .replace(/<sc-(for|if)\b/g, '<template data-sc="$1"')
    .replace(/<\/sc-(for|if)>/g, '</template>');
  const doc = new DOMParser().parseFromString(safe, 'text/html');
  const root = doc.querySelector('x-dc');
  if (!root) throw new Error('No <x-dc> in the design.');
  const helmetEl = root.querySelector(':scope > helmet');
  const template = [...root.childNodes].filter((node) => node !== helmetEl);
  const script = doc.querySelector('script[data-dc-script]');
  const declared = JSON.parse(script?.getAttribute('data-props') ?? '{}') as Record<
    string,
    { default?: unknown }
  >;
  const defaults = Object.fromEntries(
    Object.entries(declared)
      .filter(([key, spec]) => !key.startsWith('$') && spec && 'default' in spec)
      .map(([key, spec]) => [key, spec.default]),
  );
  const Component = script
    ? // The prototype is Kunal's own artifact, saved in this repository as a reference.
      (new Function('DCLogic', `${script.textContent}\nreturn Component;`)(DCLogic) as new (
        props: Scope,
      ) => DCLogic & { renderVals(): Scope })
    : null;
  return {
    template,
    helmet: helmetEl?.innerHTML ?? '',
    defaults,
    values: (props) => (Component ? new Component(props).renderVals() : {}),
  };
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

async function renderNodes(
  nodes: Iterable<Node>,
  scope: Scope,
  load: Loader,
  helmets: string[],
): Promise<Node[]> {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(document.createTextNode(interpolate(node.textContent ?? '', scope)));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const kind = el.localName === 'template' ? el.getAttribute('data-sc') : null;
    const inner =
      el.localName === 'template' ? (el as HTMLTemplateElement).content.childNodes : el.childNodes;
    if (kind === 'for') {
      const list = valueOf(el.getAttribute('list') ?? '', scope);
      const as = el.getAttribute('as') ?? 'item';
      const items = Array.isArray(list) ? (list as unknown[]) : [];
      for (const [index, item] of items.entries()) {
        out.push(
          ...(await renderNodes(inner, { ...scope, [as]: item, $index: index }, load, helmets)),
        );
      }
      continue;
    }
    if (kind === 'if') {
      if (valueOf(el.getAttribute('value') ?? '', scope)) {
        out.push(...(await renderNodes(inner, scope, load, helmets)));
      }
      continue;
    }
    if (el.localName === 'dc-import') {
      const props: Scope = {};
      for (const attr of el.attributes) {
        if (attr.name === 'name' || attr.name.startsWith('hint-')) continue;
        props[camel(attr.name)] = valueOf(attr.value, scope);
      }
      const child = await renderDesign(`${el.getAttribute('name')}.dc.html`, props, load);
      helmets.push(...child.helmet);
      out.push(...child.nodes);
      continue;
    }
    const copy = document.importNode(el, false);
    for (const attr of [...copy.attributes]) {
      if (/^on[A-Z]/.test(attr.name) || /^on[a-z]+$/.test(attr.name))
        copy.removeAttribute(attr.name);
      else copy.setAttribute(attr.name, interpolate(attr.value, scope));
    }
    copy.append(...(await renderNodes(inner, scope, load, helmets)));
    out.push(copy);
  }
  return out;
}

/** Renders one artboard with these props over its declared defaults. */
export async function renderDesign(
  file: string,
  props: Scope,
  load: Loader,
): Promise<{ nodes: Node[]; helmet: string[] }> {
  const design = parse(await load(file));
  const merged = { ...design.defaults, ...props };
  const scope = { ...merged, ...design.values(merged) };
  const helmet = [design.helmet];
  const nodes = await renderNodes(design.template, scope, load, helmet);
  return { nodes, helmet };
}
