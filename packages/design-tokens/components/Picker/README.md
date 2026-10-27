# Picker

A picker is a compact choice in a bar, such as the language or the theme: an icon, the current value and a chevron.

## Anatomy
`control-sm` high · leading `icon-sm` in `text-muted` · value in `label` weight · chevron in `text-muted` with `space-3` beside it · `border-strong` outline and `radius-md`, as the inputs have · `surface-sunken` on hover, `accent` outline on focus.

## The consumer provides
A label for screen readers (the bar shows only the icon and the value), the icon, and the options. Language options are named in their own language and carry `lang`.

## Rules
- It is a native select underneath, so the keyboard, screen readers and phones work as they do everywhere.
- Use it in bars and toolbars only. A choice in a form is a labelled field (TextField with a select).
- An icon that follows the value, such as sun, moon or contrast for the theme, shows what is chosen; it never replaces the value's words.
