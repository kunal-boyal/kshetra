import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { avatarHue } from '@thelamp/shared';
import { Bell, CircleCheck, Info, LogOut, Pause, Search, Store } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { ActionBar, AppBar, CartBar, IconButton } from './bars';
import { BottomNav } from './bottom-nav';
import { Button } from './button';
import { ChipGroup, SegmentedControl } from './choosers';
import { Avatar } from './identity';
import { ListRow } from './lists';
import { ProgressBar, Steps } from './measures';
import { PhotoStrip } from './photos';
import { Screen } from './screen';
import { ShiftCard } from './shift-card';
import { QuantityStepper } from './stepper';
import { Flag } from './status';
import { Card, IconChip, Notice } from './surfaces';
import { Text } from './text';
import { TextField } from './text-field';
import { createTheme, ThemeProvider } from './theme';

/** The phone's building blocks for the revamp (phase U, stage M1, decision D104). */

const CHOICES = [
  { value: 'all', label: 'All' },
  { value: 'seeds', label: 'Seeds' },
] as const;

describe('ListRow', () => {
  it('reads every part as one name, and holds a lead, an end and an unread dot', async () => {
    const onPress = jest.fn();
    await render(
      <ListRow
        label="Patel Krishi Kendra"
        detail="Retailer · Sanwer"
        meta="Last visit 3 days ago"
        lead={<IconChip icon={Store} hue="sage" />}
        trailing={<Text>₹42,000</Text>}
        unread
        unreadLabel="new"
        onPress={onPress}
      />,
    );
    const row = screen.getByRole('button', {
      name: 'Patel Krishi Kendra, Retailer · Sanwer, Last visit 3 days ago, new',
    });
    expect(screen.getByText('₹42,000')).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('stays a plain row with a label alone, as before', async () => {
    await render(<ListRow label="Version" detail="1.4.0" />);
    expect(screen.getByText('Version')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AppBar, ActionBar and CartBar', () => {
  it('goes back with a named button, and the cart bar says what it holds', async () => {
    const back = jest.fn();
    const review = jest.fn();
    await render(
      <View>
        <AppBar
          title="New order"
          subtitle="Shree Krishna Agro"
          onBack={back}
          backLabel="Back to the visit"
          action={<IconButton icon={Bell} label="Inbox" count={120} onPress={() => undefined} />}
        />
        <ActionBar>
          <Button label="Save" />
        </ActionBar>
        <CartBar count="4 items" total="₹19,780" note="+ GST" action="Review" onPress={review} />
      </View>,
    );
    expect(screen.getByRole('heading', { name: 'New order' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the visit' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Inbox, 99+' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Review: 4 items, ₹19,780 + GST' }));
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('shows no count at 0', async () => {
    await render(<IconButton icon={Bell} label="Inbox" count={0} onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeOnTheScreen();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('ChipGroup and SegmentedControl', () => {
  it('chooses one, as a radio group', async () => {
    const onChange = jest.fn();
    await render(
      <View>
        <ChipGroup label="Category" choices={CHOICES} value="all" onChange={onChange} />
        <SegmentedControl label="When" choices={CHOICES} value="seeds" onChange={onChange} />
      </View>,
    );
    expect(screen.getByLabelText('Category')).toHaveProp('role', 'radiogroup');
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Seeds' })[0]!);
    expect(onChange).toHaveBeenCalledWith('seeds');
    expect(screen.getAllByRole('radio', { name: 'Seeds' })[1]).toBeChecked();
  });

  it('rings the chosen chip in Outdoor instead of filling it', async () => {
    const outdoor = createTheme('outdoor', 'latin');
    await render(
      <ThemeProvider name="outdoor" script="latin">
        <ChipGroup label="Category" choices={CHOICES} value="all" onChange={() => undefined} />
      </ThemeProvider>,
    );
    const chosen = StyleSheet.flatten(screen.getByRole('radio', { name: 'All' }).props.style);
    expect(chosen).toMatchObject({ borderWidth: 2, borderColor: outdoor.colors.accent });
    expect(chosen.backgroundColor).not.toBe(outdoor.colors.accent);
  });
});

describe('Avatar', () => {
  it('takes its hue from the ID as the web does, and its initials from the name', async () => {
    const id = '01a10000-0000-7000-8000-000000000004';
    const theme = createTheme('light', 'latin');
    await render(<Avatar name="Ravi Kumar" id={id} label />);
    const avatar = screen.getByRole('img', { name: 'Ravi Kumar' });
    expect(screen.getByText('RK')).toBeOnTheScreen();
    const hue = avatarHue(id);
    const fill =
      `pastel${hue.charAt(0).toUpperCase()}${hue.slice(1)}Fill` as keyof typeof theme.colors;
    expect(StyleSheet.flatten(avatar.props.style).backgroundColor).toBe(theme.colors[fill]);
  });
});

describe('ProgressBar and Steps', () => {
  it('never shows more than the whole, and says how much is done', async () => {
    await render(
      <ProgressBar
        label="Visits done"
        parts={[
          { value: 0.8, tone: 'done' },
          { value: 0.5, tone: 'pending' },
        ]}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Visits done' });
    expect(bar.props['aria-valuenow']).toBe(80);
    const widths = (bar.props.children as { props: { style: { width: string } } }[]).map(
      (part) => part.props.style.width,
    );
    expect(widths).toEqual(['80%', '20%']);
  });

  it('marks each step done, now, turned down or to come', async () => {
    await render(
      <Steps
        label="Approval"
        steps={[
          { state: 'done', title: 'Asked by Ravi' },
          { state: 'current', title: 'Waiting for Neha', meta: 'Since 10:05' },
          { state: 'todo', title: 'Business Head' },
        ]}
      />,
    );
    expect(screen.getByLabelText('Approval')).toHaveProp('role', 'list');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Since 10:05')).toBeOnTheScreen();
  });
});

describe('PhotoStrip, Flag and Notice', () => {
  it('ends the strip with a dashed tile that takes another photo', async () => {
    const onAdd = jest.fn();
    await render(
      <PhotoStrip
        label="Photos"
        photos={[{ time: '10:42', label: 'Shop front, 10:42' }]}
        onAdd={onAdd}
        addLabel="Take a photo"
      />,
    );
    expect(screen.getByRole('img', { name: 'Shop front, 10:42' })).toBeOnTheScreen();
    expect(screen.getByText('10:42')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('colours a flag and a notice by their tone', async () => {
    const theme = createTheme('light', 'latin');
    await render(
      <View>
        <Flag label="Outside the geofence" tone="danger" />
        <Notice tone="info" icon={Info}>
          Prices changed today.
        </Notice>
      </View>,
    );
    expect(StyleSheet.flatten(screen.getByText('Outside the geofence').props.style).color).toBe(
      theme.colors.dangerFg,
    );
    expect(StyleSheet.flatten(screen.getByText('Prices changed today.').props.style).color).toBe(
      theme.colors.infoFg,
    );
  });
});

describe('BottomNav counts and small buttons', () => {
  it('names a tab with what waits there', async () => {
    await render(
      <BottomNav
        label="Main"
        items={[
          {
            key: 'team',
            label: 'Team',
            icon: Bell,
            active: false,
            onPress: () => undefined,
            count: 5,
          },
          { key: 'home', label: 'Home', icon: Bell, active: true, onPress: () => undefined },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Team, 5' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Home' })).toBeOnTheScreen();
  });

  it('makes a small button 40 px tall', async () => {
    await render(<Button label="Add" size="sm" />);
    const button = screen.getByRole('button', { name: 'Add' });
    const style = StyleSheet.flatten(
      typeof button.props.style === 'function'
        ? button.props.style({ pressed: false })
        : button.props.style,
    );
    expect(style.minHeight).toBe(40);
  });
});

describe('ShiftCard stats and tinted cards (stage M2)', () => {
  it('counts time, distance and visits three across on duty, and ends the day on the tint', async () => {
    const theme = createTheme('light', 'latin');
    await render(
      <ShiftCard
        state="on"
        title="On duty since 9:12"
        badge="Tracking"
        stats={[
          { value: '4 h 18 min', label: 'on duty' },
          { value: '18.4 km', label: 'travelled, about' },
          { value: '3', label: 'visits' },
        ]}
        note="Location is recorded only while you are on duty."
        actions={[
          { label: 'Pause', icon: Pause, onPress: () => undefined },
          { label: 'End day', icon: LogOut, tonal: true, onPress: () => undefined },
        ]}
      />,
    );
    expect(screen.getByText('18.4 km')).toBeOnTheScreen();
    expect(screen.getByText('travelled, about')).toBeOnTheScreen();
    const end = screen.getByRole('button', { name: 'End day' });
    const style = StyleSheet.flatten(
      typeof end.props.style === 'function' ? end.props.style({ pressed: false }) : end.props.style,
    );
    expect(style.backgroundColor).toBe(theme.colors.accentSubtle);
  });

  it('lies a tinted card flat on its hue', async () => {
    const light = createTheme('light', 'latin');
    await render(<Card tint="mint" testID="tile" />);
    const flat = StyleSheet.flatten(screen.getByTestId('tile').props.style);
    expect(flat.backgroundColor).toBe(light.colors.pastelMintBg);
    expect(flat.boxShadow).toBeUndefined();
  });
});

describe('large photo tiles and a held footer (stage M3)', () => {
  it("draws a form's photo tiles at 96 px, the add tile too", async () => {
    await render(
      <PhotoStrip
        size="lg"
        label="Photos"
        photos={[{ label: 'Photo 1' }]}
        onAdd={() => undefined}
        addLabel="Take a photo"
      />,
    );
    expect(
      StyleSheet.flatten(screen.getByRole('img', { name: 'Photo 1' }).props.style),
    ).toMatchObject({ width: 96, height: 96 });
    const add = screen.getByRole('button', { name: 'Take a photo' });
    const style = StyleSheet.flatten(
      typeof add.props.style === 'function' ? add.props.style({ pressed: false }) : add.props.style,
    );
    expect(style).toMatchObject({ width: 96, height: 96 });
  });

  it('holds a footer below the scrolling content', async () => {
    await render(
      <Screen
        footer={
          <ActionBar>
            <Button label="Check out" />
          </ActionBar>
        }
      >
        <Text>On this visit</Text>
      </Screen>,
    );
    expect(screen.getByText('On this visit')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Check out' })).toBeOnTheScreen();
  });
});

describe('QuantityStepper, the search field and a success notice', () => {
  it('steps by its named ends and opens the exact entry from its value', async () => {
    const onLess = jest.fn();
    const onMore = jest.fn();
    const onValue = jest.fn();
    await render(
      <QuantityStepper
        value="40"
        valueLabel="Quantity of NPK 19:19:19, 40"
        lessLabel="Fewer NPK 19:19:19"
        moreLabel="More NPK 19:19:19"
        onLess={onLess}
        onMore={onMore}
        onValue={onValue}
      />,
    );
    expect(screen.getByText('40')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Fewer NPK 19:19:19' }));
    await fireEvent.press(screen.getByRole('button', { name: 'More NPK 19:19:19' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Quantity of NPK 19:19:19, 40' }));
    expect(onLess).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('keeps a long value whole beside its ends', async () => {
    await render(
      <QuantityStepper
        value="1,250.5"
        valueLabel="Quantity, 1,250.5"
        lessLabel="Fewer"
        moreLabel="More"
        onLess={() => undefined}
        onMore={() => undefined}
      />,
    );
    expect(screen.getByText('1,250.5')).toBeOnTheScreen();
    // Without an exact entry the value is not a button.
    expect(screen.queryByRole('button', { name: 'Quantity, 1,250.5' })).toBeNull();
  });

  it('names a search by its hidden label, which stands as its placeholder', async () => {
    await render(<TextField label="Search items or codes" icon={Search} labelHidden />);
    const field = screen.getByLabelText('Search items or codes');
    expect(field.props.placeholder).toBe('Search items or codes');
    expect(screen.queryByText('Search items or codes')).toBeNull();
  });

  it('colours a success notice', async () => {
    const theme = createTheme('light', 'latin');
    await render(
      <Notice tone="success" icon={CircleCheck}>
        Within credit.
      </Notice>,
    );
    expect(StyleSheet.flatten(screen.getByText('Within credit.').props.style).color).toBe(
      theme.colors.successFg,
    );
  });
});
