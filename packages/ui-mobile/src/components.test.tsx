/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChartNoAxesColumn, CircleAlert, Send } from 'lucide-react-native';
import { Button } from './button';
import { KpiTile } from './kpi';
import { StatusBadge, SyncBanner } from './status';
import { TextField } from './text-field';
import { createTheme, ThemeProvider } from './theme';

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

describe('SyncBanner', () => {
  it('is one button that says what waits and what tapping does', async () => {
    const onPress = jest.fn();
    await render(
      <SyncBanner
        tone="danger"
        icon={CircleAlert}
        message="2 items were refused."
        action="View"
        onPress={onPress}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: '2 items were refused. View' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('inverts in Outdoor: the status ink becomes the fill', async () => {
    const outdoor = createTheme('outdoor', 'latin');
    await render(
      <ThemeProvider name="outdoor" script="latin">
        <SyncBanner
          tone="pending"
          icon={CircleAlert}
          message="Waiting"
          action="View"
          onPress={() => undefined}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: outdoor.colors.pendingFg });
    expect(screen.getByText('Waiting')).toHaveStyle({ color: outdoor.colors.textInverse });
  });
});

describe('StatusBadge', () => {
  it('always shows the word, in its variant’s ink', async () => {
    const light = createTheme('light', 'latin');
    await render(<StatusBadge variant="danger" label="Refused" />);
    expect(screen.getByText('Refused')).toHaveStyle({ color: light.colors.dangerFg });
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
      join(__dirname, '../../design-tokens/assets/Logos/mark-small.svg'),
      'utf8',
    );
    const component = readFileSync(join(__dirname, 'brand.tsx'), 'utf8');
    const values = (text: string) =>
      [...text.matchAll(/\b(d|r|fill|stroke|stroke-?[wW]idth|viewBox)="([^"]+)"/g)]
        .map(([, name, value]) => `${name!.toLowerCase().replace('-', '')}=${value}`)
        .sort();
    expect(values(component)).toEqual(values(svg));
  });
});

describe('KpiTile', () => {
  it('shows the approved figure, its share of the target, and pending work apart', async () => {
    await render(
      <KpiTile
        label="Sales"
        icon={ChartNoAxesColumn}
        value="₹8.4 L"
        progress={{ done: 0.68, pending: 0.09 }}
        foot="68% of ₹12.4 L"
        pending="+₹1.1 L pending"
      />,
    );
    expect(screen.getByText('₹8.4 L')).toBeOnTheScreen();
    expect(screen.getByText('68% of ₹12.4 L')).toBeOnTheScreen();
    expect(screen.getByText('+₹1.1 L pending')).toBeOnTheScreen();
  });

  it('leaves the bar empty without a target', async () => {
    await render(
      <KpiTile
        label="Meetings"
        icon={ChartNoAxesColumn}
        value="3"
        progress={null}
        foot="No target set"
      />,
    );
    expect(screen.getByText('No target set')).toBeOnTheScreen();
    expect(screen.queryByText(/pending/)).toBeNull();
  });
});

describe('the tenant accent (tenant-theming.md)', () => {
  it('replaces the six accent colours and the focus ring, and nothing else', () => {
    const accent = {
      accent: '#0f6e6e',
      accentHover: '#0a5a5a',
      accentSubtle: '#eaf6f5',
      accentSoft: '#cdeae7',
      accentSubtleFg: '#0d4a49',
      onAccent: '#ffffff',
    };
    const product = createTheme('light', 'latin');
    const branded = createTheme('light', 'latin', undefined, accent);
    expect(branded.colors).toEqual({ ...product.colors, ...accent, focusRing: '#0f6e6e' });
  });
});
