// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { interpolate, lookup, renderDesign } from './render.ts';

const page = (body: string, script = '', props = '{}') => `<!doctype html>
<html lang="en"><head><title>Test</title></head><body>
<x-dc>
<helmet><style>body{margin:0}</style></helmet>
${body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='${props}'>
class Component extends DCLogic {
  renderVals() { return ${script || '{}'}; }
}
</script>
</body></html>`;

async function render(files: Record<string, string>, file: string, props = {}) {
  const host = document.createElement('div');
  const { nodes, helmet } = await renderDesign(file, props, async (name) => {
    const text = files[name];
    if (text === undefined) throw new Error(`No file ${name}`);
    return text;
  });
  host.append(...nodes);
  return { host, helmet };
}

describe('lookup and interpolate', () => {
  it('reads dotted paths and literals, never expressions', () => {
    const scope = { r: { tone: 'info', n: 3 }, $index: 1 };
    expect(lookup(scope, 'r.tone')).toBe('info');
    expect(lookup(scope, '$index')).toBe(1);
    expect(lookup(scope, 'true')).toBe(true);
    expect(lookup(scope, '42')).toBe(42);
    expect(lookup(scope, 'r.missing')).toBeUndefined();
    expect(interpolate('ks-badge {{ r.tone }} n{{r.n}}{{gone}}', scope)).toBe('ks-badge info n3');
  });
});

describe('renderDesign', () => {
  it('fills holes in text, attributes and styles, and drops event handlers', async () => {
    const files = {
      'A.dc.html': page(
        '<div data-theme="{{theme}}" style="width: {{w}}px"><button onClick="{{go}}">{{label}}</button></div>',
        "{ theme: this.props.theme ?? 'light', w: 390, label: 'Approve', go: () => {} }",
        '{"theme":{"editor":"enum","default":"light"}}',
      ),
    };
    const { host, helmet } = await render(files, 'A.dc.html', { theme: 'dark' });
    const div = host.querySelector('div')!;
    expect(div.dataset.theme).toBe('dark');
    expect(div.getAttribute('style')).toBe('width: 390px');
    expect(host.querySelector('button')!.textContent).toBe('Approve');
    expect(host.querySelector('button')!.hasAttribute('onClick')).toBe(false);
    expect(helmet.join('')).toContain('body{margin:0}');
  });

  it('repeats rows inside a table body and keeps the table whole', async () => {
    const files = {
      'T.dc.html': page(
        '<table><tbody><sc-for list="{{rows}}" as="r"><tr><td>{{$index}}</td><td>{{r.name}}</td></tr></sc-for></tbody></table>',
        "{ rows: [{ name: 'Ravi' }, { name: 'Neha' }] }",
      ),
    };
    const { host } = await render(files, 'T.dc.html');
    const cells = [...host.querySelectorAll('table tbody tr')].map((tr) => tr.textContent);
    expect(cells).toEqual(['0Ravi', '1Neha']);
  });

  it('shows an sc-if only when its value is truthy', async () => {
    const files = {
      'I.dc.html': page(
        '<p><sc-if value="{{yes}}"><b>shown</b></sc-if><sc-if value="{{no}}"><i>hidden</i></sc-if></p>',
        '{ yes: true, no: null }',
      ),
    };
    const { host } = await render(files, 'I.dc.html');
    expect(host.querySelector('b')?.textContent).toBe('shown');
    expect(host.querySelector('i')).toBeNull();
  });

  it('mounts an imported design with its attributes as props, camel-cased', async () => {
    const files = {
      'Outer.dc.html': page(
        '<nav><dc-import name="Rail" current="home" item-count="{{n}}" hint-size="248px,1100px"></dc-import></nav>',
        '{ n: 4 }',
      ),
      'Rail.dc.html': page(
        '<a aria-current="{{current}}">{{count}}</a>',
        '{ current: this.props.current, count: this.props.itemCount }',
      ),
    };
    const { host } = await render(files, 'Outer.dc.html');
    const link = host.querySelector('nav a')!;
    expect(link.getAttribute('aria-current')).toBe('home');
    expect(link.textContent).toBe('4');
  });

  it('keeps SVG in its namespace', async () => {
    const files = {
      'S.dc.html': page(
        '<svg class="ks-icon" viewBox="0 0 24 24"><path d="{{d}}"></path></svg>',
        "{ d: 'M5 12h14' }",
      ),
    };
    const { host } = await render(files, 'S.dc.html');
    const path = host.querySelector('path')!;
    expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(path.getAttribute('d')).toBe('M5 12h14');
  });
});
