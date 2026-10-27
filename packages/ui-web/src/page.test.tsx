import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DescriptionList, PageHeader, Section } from './page';
import { expectAccessible } from './test-axe';

describe('PageHeader', () => {
  it('is the page’s one heading, with its meta, actions and toolbar where given', async () => {
    const { container } = render(
      <PageHeader
        title="Expenses · October"
        meta="64 claims · ₹1,42,300"
        actions={<button type="button">Export</button>}
        toolbar={<span>chips</span>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Expenses · October' }),
    ).toBeInTheDocument();
    expect(screen.getByText('64 claims · ₹1,42,300')).toHaveClass('ks-meta');
    expect(container.querySelector('.ks-page-toolbar')).toHaveTextContent('chips');
    await expectAccessible(container);
  });

  it('leaves out what isn’t given', () => {
    const { container } = render(<PageHeader title="People" />);
    expect(container.querySelector('.ks-meta')).toBeNull();
    expect(container.querySelector('.ks-page-actions')).toBeNull();
    expect(container.querySelector('.ks-page-toolbar')).toBeNull();
  });
});

describe('DescriptionList and Section', () => {
  it('pairs labels with values, right-aligned for amounts, in a titled card', async () => {
    const { container } = render(
      <Section title="Totals" actions={<button type="button">Print</button>}>
        <DescriptionList
          align="end"
          items={[
            ['Lines', '4'],
            ['Total', '₹19,780'],
          ]}
        />
      </Section>,
    );
    expect(container.querySelector('dl')).toHaveClass('ks-dl', 'end');
    expect(screen.getByRole('heading', { level: 2, name: 'Totals' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});
