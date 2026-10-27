import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FilterChips, SegmentedControl, tabPanelProps, Tabs } from './choosers';
import { expectAccessible } from './test-axe';

type Status = 'waiting' | 'flagged' | 'done';
const CHOICES = [
  { value: 'waiting', label: 'Waiting', count: 1443 },
  { value: 'flagged', label: 'With flags', count: 5 },
  { value: 'done', label: 'Done' },
] as const;

describe('FilterChips', () => {
  it('presses the chosen chip, shows counts in the locale, and clears only when asked', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <FilterChips<Status>
        label="Status"
        choices={CHOICES}
        value="waiting"
        onChange={onChange}
        formatCount={(n) => n.toLocaleString('en-IN')}
      />,
    );
    const waiting = screen.getByRole('button', { name: 'Waiting · 1,443' });
    expect(waiting).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(waiting);
    expect(onChange).toHaveBeenLastCalledWith('waiting');
    rerender(
      <FilterChips<Status>
        label="Status"
        choices={CHOICES}
        value="waiting"
        onChange={onChange}
        clearable
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Waiting · 1443' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await expectAccessible(container);
  });
});

describe('SegmentedControl', () => {
  it('always has one view chosen', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl<Status>
        label="View"
        choices={CHOICES}
        value="flagged"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onChange).toHaveBeenCalledWith('done');
    expect(screen.getByRole('button', { name: 'With flags · 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(container);
  });
});

function TabsHarness() {
  const [value, setValue] = useState<Status>('waiting');
  return (
    <>
      <Tabs<Status>
        label="Accounts"
        idPrefix="kinds"
        choices={CHOICES}
        value={value}
        onChange={setValue}
      />
      <div {...tabPanelProps('kinds', value)}>Panel {value}</div>
    </>
  );
}

describe('Tabs', () => {
  it('keeps one tab in the tab order and moves with the arrow keys, wrapping round', async () => {
    const { container } = render(<TabsHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Done' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Done' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Waiting · 1443' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel done');
    await expectAccessible(container);
  });
});
