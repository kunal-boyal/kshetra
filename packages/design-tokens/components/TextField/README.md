# TextField

A text field collects one value with a visible label above it and help or an error below it.

## Anatomy
`label-md` label (required marked with `*` in `danger-fg` and in the accessible name) · input with `border-strong` outline at the density's control height · help in `text-muted`, replaced by the error in `danger-fg` when invalid.

## The consumer provides
Label and help from the form definition, keyboard type per field type (numeric fields open the number pad and right-align with tabular figures), validation from `packages/forms` so the phone and server agree.

## Rules
- Placeholder is an example, never the label.
- Errors say how to fix: "Enter a count, 0 or more." not "Invalid".
- Validate on blur and submit, not per keystroke.
