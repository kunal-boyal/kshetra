import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './data';
import { List, ListItem, SplitDetail } from './lists';
import { expectAccessible } from './test-axe';

const LONG = 'Shri Laxmi Narayan Krishi Seva Kendra and Agro Traders, Dindori';

describe('ListItem', () => {
  it('cuts a long title to one line and keeps it whole in a tooltip', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <List label="Waiting for you">
        <ListItem
          title={LONG}
          meta="Retailer · 1.2 km"
          trailing={<span>14</span>}
          href="/accounts/1"
        />
        <ListItem title="Visits to review" onClick={onClick} selected />
        <ListItem title="Plain" />
      </List>,
    );
    expect(screen.getByText(LONG)).toHaveAttribute('title', LONG);
    expect(screen.getByRole('link', { name: /Shri Laxmi/ })).toHaveAttribute('href', '/accounts/1');
    const button = screen.getByRole('button', { name: 'Visits to review' });
    expect(button).toHaveClass('sel');
    expect(button).toHaveAttribute('aria-current', 'true');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('SplitDetail', () => {
  it('shows the detail beside the list, and gives the list the width without one', async () => {
    const { container, rerender } = render(
      <SplitDetail list={<p>rows</p>} detail={<p>chosen</p>} detailLabel="Order 1187" />,
    );
    expect(screen.getByRole('complementary', { name: 'Order 1187' })).toHaveTextContent('chosen');
    await expectAccessible(container);
    rerender(<SplitDetail list={<p>rows</p>} detail={null} detailLabel="Order" />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(container.querySelector('.ks-split')).toHaveClass('single');
  });
});

describe('DataTable', () => {
  it('marks the chosen row, and keeps codes in tabular figures at the start', async () => {
    const rows = [
      { id: 'a', code: 'R-2210', amount: '₹12,000' },
      { id: 'b', code: 'R-2211', amount: '₹26,400' },
    ];
    const { container } = render(
      <DataTable
        caption="Orders"
        rowKey={(row) => row.id}
        rows={rows}
        selectedKey="b"
        stickyFirst
        columns={[
          { key: 'code', header: 'Code', align: 'num', render: (row) => row.code },
          { key: 'amount', header: 'Amount', align: 'end', render: (row) => row.amount },
        ]}
      />,
    );
    const [, first, second] = screen.getAllByRole('row');
    expect(second).toHaveClass('sel');
    expect(first).not.toHaveClass('sel');
    expect(screen.getByText('R-2210')).toHaveClass('ks-num');
    expect(container.querySelector('table')).toHaveClass('sticky-first');
    await expectAccessible(container);
  });
});
