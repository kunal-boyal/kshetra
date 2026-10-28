# TextField

A text field collects one value with a visible label above it and help or an error below it.

## Anatomy
`label-md` label (required marked with `*` in `danger-fg` and in the accessible name) · input with `border-strong` outline at the density's control height · help in `text-muted`, replaced by the error in `danger-fg` when invalid. An invalid input's edge turns `danger-solid`, 1 px (2 px in Outdoor, as every input), with a 3 px `danger-bg` halo only while it has focus: never a doubled border.

## The consumer provides
Label and help from the form definition, keyboard type per field type (numeric fields open the number pad and right-align with tabular figures), validation from `packages/forms` so the phone and server agree.

## Rules
- Placeholder is an example, never the label. The one exception is a search: a magnifier inside the field before the value (`ks-affix`; `icon` on the phone) says what it is, and its label names it for screen readers and stands as its placeholder (`labelHidden`).
- Errors say how to fix: "Enter a count, 0 or more." not "Invalid".
- Check on submit, by its button or Enter, never on leaving a field or per keystroke: clicking elsewhere says nothing. Once shown, an error follows the value and clears as it is fixed.
- Where an error would move what follows, as on sign-in, a field that can show one keeps a line for its help or error, filled or not (`ks-help reserve`; `reserveNote` on the web), or two for a long message (`reserve two`). Give such a field a help line, so the kept line is never an empty gap. A form's own message keeps its line under its button.
- A choice from a list is the same field with a native `select`: `select.ks-input` draws its own chevron, with the field's padding beside it, never the browser's arrow.
