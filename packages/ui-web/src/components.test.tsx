import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
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
