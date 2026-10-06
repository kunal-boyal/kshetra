/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Send } from 'lucide-react-native';
import { Button } from './button';
import { TextField } from './text-field';
import { createTheme } from './theme';

describe('Button', () => {
  it('is a button named by its label, and presses', async () => {
    const onPress = jest.fn();
    await render(<Button variant="primary" icon={Send} label="Send code" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('stays put while busy and cannot be pressed again', async () => {
    const onPress = jest.fn();
    await render(<Button label="Sign in" busy onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('names a required field with its mark, and announces an error', async () => {
    await render(
      <TextField label="Code" required help="Enter the code" error="That code is not right." />,
    );
    expect(screen.getByLabelText('Code *')).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('That code is not right.');
    expect(screen.queryByText('Enter the code')).toBeNull();
  });
});

describe('type', () => {
  it('gives Hindi 4 px more line height and never sets it below 13 px (README, Type)', () => {
    const latin = createTheme('light', 'latin');
    const hindi = createTheme('light', 'devanagari');
    expect(latin.text('bodyLg')).toMatchObject({ fontSize: 16, lineHeight: 24 });
    expect(hindi.text('bodyLg')).toMatchObject({ fontSize: 16, lineHeight: 28 });
    expect(latin.text('caption')).toMatchObject({ fontSize: 12, lineHeight: 16 });
    expect(hindi.text('caption')).toMatchObject({ fontSize: 13, lineHeight: 21 });
  });

  it('uses a loaded face for its weight, or the system font at that weight', () => {
    const faces = { latin: { 400: 'Sans', 500: 'SansMedium', 600: 'SansSemi', 700: 'SansBold' } };
    const loaded = createTheme('dark', 'latin', faces);
    expect(loaded.text('headingMd')).toMatchObject({ fontFamily: 'SansSemi' });
    expect(loaded.text('headingMd')).not.toHaveProperty('fontWeight');
    expect(loaded.text('bodySm', 500)).toMatchObject({ fontFamily: 'SansMedium' });
    expect(createTheme('dark', 'latin').text('headingMd')).toMatchObject({ fontWeight: '600' });
  });

  it('turns letter spacing in em into points', () => {
    expect(createTheme('light', 'latin').text('display').letterSpacing).toBeCloseTo(-0.32);
  });
});

describe('BrandMark', () => {
  it('draws exactly the small mark in the design system', () => {
    const svg = readFileSync(
      join(__dirname, '../../design-tokens/assets/Logos/kshetra-mark-small.svg'),
      'utf8',
    );
    const component = readFileSync(join(__dirname, 'brand.tsx'), 'utf8');
    const values = (text: string) =>
      [...text.matchAll(/\b(r|fill|stroke|stroke-?[wW]idth|viewBox)="([^"]+)"/g)]
        .map(([, name, value]) => `${name!.toLowerCase().replace('-', '')}=${value}`)
        .sort();
    expect(values(component)).toEqual(values(svg));
  });
});
