import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, RankBadge } from './identity';
import { expectAccessible } from './test-axe';

const ID = '01a17d44-55c7-7581-ba9c-5cb74b321e59';

describe('Avatar', () => {
  it('draws the initials on the person’s own hue, the same every time', () => {
    const { container } = render(
      <>
        <Avatar name="Kavita Deshmukh" id={ID} />
        <Avatar name="Kavita Deshmukh" id={ID} size="lg" />
      </>,
    );
    const [small, large] = container.querySelectorAll('.ks-ico');
    const hue = [...small!.classList].find((name) => name.startsWith('hue-'));
    expect(hue).toBeDefined();
    expect(large).toHaveClass(hue!, 'lg', 'round');
    expect(small).toHaveTextContent('KD');
  });

  it('is decoration beside a written name, and named when it stands alone', async () => {
    const { container } = render(
      <p>
        <Avatar name="Sunita Joshi" id={ID} /> Sunita Joshi{' '}
        <Avatar name="Arjun Mehta" id="x" label />
      </p>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('SJ');
    expect(screen.getByRole('img', { name: 'Arjun Mehta' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('RankBadge', () => {
  it('colours the first three places and no others', async () => {
    const { container } = render(
      <div>
        <RankBadge rank={2} label="Rank 2" />
        <RankBadge rank={7} label="Rank 7" />
      </div>,
    );
    const [second, seventh] = container.querySelectorAll('.ks-seq');
    expect(second).toHaveClass('hue-sand');
    expect([...seventh!.classList].some((name) => name.startsWith('hue-'))).toBe(false);
    expect(screen.getByLabelText('Rank 7')).toHaveTextContent('7');
    await expectAccessible(container);
  });
});
