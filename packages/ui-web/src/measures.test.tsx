import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapPin } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Icon } from './icon';
import { PeriodStepper, ShareBar, StackedBar, StatTile, Steps } from './measures';
import { expectAccessible } from './test-axe';

describe('StatTile', () => {
  it('shows the figure with its line, and keeps the bar between empty and full', async () => {
    const { container } = render(
      <div>
        <StatTile
          label="On duty now"
          value="38"
          sub="of 46 people · 6 on leave"
          meter={1.4}
          icon={<Icon icon={MapPin} />}
          hue="mint"
        />
        <StatTile label="Overdue" value="₹12,000" tone="danger" />
      </div>,
    );
    expect(screen.getByText('38')).toHaveClass('ks-kpi-value');
    expect(container.querySelector('.ks-bar > i')).toHaveStyle({ width: '100%' });
    expect(container.querySelectorAll('.ks-bar')).toHaveLength(1);
    expect(screen.getByText('₹12,000').closest('.ks-kpi')).toHaveClass('danger');
    await expectAccessible(container);
  });
});

describe('ShareBar and StackedBar', () => {
  it('sizes parts by value and lists every part for screen readers', async () => {
    const { container } = render(
      <ShareBar
        label="How the score is made"
        parts={[
          { label: 'Visits', value: 30 },
          { label: 'Meetings', value: 20 },
          { label: 'Order value', value: 50 },
        ]}
      />,
    );
    const parts = [...container.querySelectorAll<HTMLElement>('.ks-share-part')];
    expect(parts.map((part) => part.style.flex.split(' ')[0])).toEqual(['30', '20', '50']);
    expect(screen.getByRole('img', { name: 'How the score is made' })).toBeInTheDocument();
    expect(screen.getByText('Meetings: 20')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('draws nothing for nothing', () => {
    const { container } = render(
      <>
        <ShareBar label="Empty" parts={[]} />
        <StackedBar label="Ageing" parts={[{ label: 'Not due', value: 0, tone: 'neutral' }]} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names each state in a legend beside its colour', async () => {
    const { container } = render(
      <StackedBar
        label="Ageing"
        format={(n) => `₹${n.toLocaleString('en-IN')}`}
        parts={[
          { label: 'Not due', value: 26400, tone: 'neutral' },
          { label: 'Overdue', value: 12000, tone: 'danger' },
        ]}
      />,
    );
    expect(container.querySelector('.ks-legend')).toHaveTextContent('Overdue ₹12,000');
    await expectAccessible(container);
  });
});

describe('PeriodStepper', () => {
  it('steps a month either way and stops at its ends', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PeriodStepper
        value="2026-10"
        max="2026-10"
        onChange={onChange}
        format={(p) => (p === '2026-10' ? 'October 2026' : p)}
        label="Month"
        previousLabel="Previous month"
        nextLabel="Next month"
      />,
    );
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onChange).toHaveBeenCalledWith('2026-09');
    await expectAccessible(container);
  });
});

describe('Steps', () => {
  it('marks done with a check, turned down with a cross, and what is to come as muted', async () => {
    const { container } = render(
      <Steps
        label="Chain"
        steps={[
          { state: 'done', title: 'Ravi asked', meta: '20 Oct' },
          { state: 'rejected', title: 'Neha turned it down' },
          { state: 'todo', title: 'Accounts team' },
        ]}
      />,
    );
    const items = container.querySelectorAll('.ks-step');
    expect(items[0]).toHaveClass('done');
    expect(items[1]).toHaveClass('rejected');
    expect(items[1]!.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Accounts team')).toHaveClass('ks-muted');
    await expectAccessible(container);
  });
});
