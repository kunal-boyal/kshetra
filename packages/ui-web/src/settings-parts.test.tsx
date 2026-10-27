import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChipList, ChoiceCard, SwitchRow } from './settings-parts';
import { expectAccessible } from './test-axe';

describe('SwitchRow', () => {
  it('is a switch named by its label that reports its new state', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <SwitchRow
        label="Expenses"
        description="Claims and policies"
        checked={false}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('switch', { name: /Expenses/ }));
    expect(onChange).toHaveBeenCalledWith(true);
    await expectAccessible(container);
  });
});

describe('ChoiceCard', () => {
  it('says which card is chosen', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <div>
        <ChoiceCard
          title="Agri inputs"
          description="SME · Beat plan"
          hue="sage"
          pressed
          onClick={onClick}
        />
        <ChoiceCard title="Pharma" pressed={false} onClick={onClick} />
      </div>,
    );
    expect(screen.getByRole('button', { name: /Agri inputs/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: /Pharma/ }));
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });
});

describe('ChipList', () => {
  it('removes the chip asked for', async () => {
    const onRemove = vi.fn();
    const { container } = render(
      <ChipList
        label="Events"
        items={['order.placed', 'visit.ended']}
        onRemove={onRemove}
        removeLabel={(item) => `Remove ${item}`}
        add={<button type="button">Add an event</button>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove visit.ended' }));
    expect(onRemove).toHaveBeenCalledWith('visit.ended');
    await expectAccessible(container);
  });
});
