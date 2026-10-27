# SettingsParts

Three parts for settings and setup pages.

## Anatomy
- **SwitchRow:** `ks-switch-row`, made of:
  - a title and a `ks-meta` line on what the setting does;
  - `ks-switch`, a native checkbox with `role="switch"`, drawn as a track and thumb: `border-strong` when off, `accent` when on.
- **ChoiceCard:** `ks-card ks-choice`, a button holding an icon chip, a title and a line, tinted in a hue when given. The chosen card carries a 2 px `accent` ring and `aria-pressed`.
- **ChipList:** `ks-chiplist`, neutral `ks-badge` chips. Each has a remove button named for its item, and the list ends with an Add control.

## The consumer provides
Labels and lines in the reader's language, the state, and what each change does.

## Rules
- A switch acts at once. A setting that needs Save is a checkbox in a form.
- Choice cards are for a few options people compare (templates, plans). Use a select for long lists.
- Removing a chip that can't be undone asks first, in place.
- Outdoor draws the switch's track and thumb with 2 px edges.
