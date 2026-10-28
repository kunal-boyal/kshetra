# TextField

A text field collects one value with a visible label above it and help or an error below it.

## Anatomy
`label-md` label (required marked with `*` in `danger-fg` and in the accessible name) · input with `border-strong` outline at the density's control height · help in `text-muted`, replaced by the error in `danger-fg` when invalid.

## The consumer provides
Label and help from the form definition, keyboard type per field type (numeric fields open the number pad and right-align with tabular figures), validation from `packages/forms` so the phone and server agree.

## Rules
- Placeholder is an example, never the label. The one exception is a search: a magnifier inside the field before the value (`ks-affix`; `icon` on the phone) says what it is, and its label names it for screen readers and stands as its placeholder (`labelHidden`).
- Errors say how to fix: "Enter a count, 0 or more." not "Invalid".
- Validate on blur and submit, not per keystroke.
- A choice from a list is the same field with a native `select`: `select.ks-input` draws its own chevron, with the field's padding beside it, never the browser's arrow.
