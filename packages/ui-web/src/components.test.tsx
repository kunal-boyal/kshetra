import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Languages } from 'lucide-react';
import { Button } from './button';
import { Picker } from './picker';
import { EmptyState } from './surfaces';
import { TextField } from './text-field';

describe('TextField', () => {
  it('names its input by its label, and ties help or the error to it', () => {
    const { rerender } = render(<TextField label="Mobile number" help="We send a code." />);
    const input = screen.getByLabelText('Mobile number');
    expect(input).toHaveAccessibleDescription('We send a code.');
    expect(input).not.toHaveAttribute('aria-invalid');

    rerender(<TextField label="Mobile number" help="We send a code." error="Enter a number." />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a number.');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.');
  });

  it('marks a required field in its accessible name', () => {
    render(<TextField label="Code" required />);
    expect(screen.getByLabelText('Code *')).toBeRequired();
  });
});

describe('Button', () => {
  it('is a plain button by default, and stays unpressable while busy', () => {
    const { rerender } = render(<Button variant="primary">Send code</Button>);
    const button = screen.getByRole('button', { name: 'Send code' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('ks-btn', 'primary');
    rerender(
      <Button variant="primary" busy>
        Send code
      </Button>,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Picker', () => {
  it('is a native select named by its label, with its icon hidden from screen readers', () => {
    const { container } = render(
      <Picker
        label="Language"
        icon={Languages}
        value="hi"
        onChange={() => {}}
        options={[
          { value: 'en', label: 'English', lang: 'en' },
          { value: 'hi', label: 'हिन्दी', lang: 'hi' },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveValue('hi');
    expect(screen.getByRole('option', { name: 'हिन्दी' })).toHaveAttribute('lang', 'hi');
    expect(container.querySelector('.ks-picker svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('EmptyState', () => {
  it('draws its chip in the accent unless given the hue of what is missing (D72)', () => {
    const { container, rerender } = render(
      <EmptyState icon={<Languages />} title="Nobody on duty">
        People show here once they start their day.
      </EmptyState>,
    );
    const chip = () => container.querySelector('.ks-ico')!;
    // No pastel class: the chip falls back to accent-subtle in bundle.css.
    expect(chip().className).not.toMatch(/hue-/);
    rerender(
      <EmptyState icon={<Languages />} hue="mint" title="Nothing waiting for review">
        New submissions appear here.
      </EmptyState>,
    );
    expect(chip()).toHaveClass('hue-mint');
  });
});
