# UI acceptance checklist (phase U)

Every stage of the UI revamp (decision D104, `docs/superpowers/plans/2026-10-27-ui-revamp.md`) meets this list before its pull request merges. It joins the stage's own checks: the prototype beside the built page in the comparison gallery (`tools/ui-compare`), Kunal's look at that gallery, and `pnpm verify`.

## Look

- [ ] The page matches its prototype artboard in layout, hierarchy and detail at 1440 and 390 px, in Light and Dark. Differences that stay are named in the pull request, with why (a decision, data the product doesn't have, or something the product does that the prototype doesn't show).
- [ ] Colours, spacing, radii, type and motion come from the tokens; no hex values, no hand-picked timings.
- [ ] People carry their `Avatar`, places and kinds their icon chip, and states their `ks-badge` tone; colour is never the only signal (a word, icon or pattern goes with it).
- [ ] Numbers use tabular figures and sit right-aligned in tables; money goes through `formatMoney`, short forms through the lakh and crore helpers.
- [ ] Icons are Lucide (decision D18), never emoji; decorative icons are hidden from screen readers and icon-only buttons are named.

## Behaviour

- [ ] Every clickable thing shows hover, focus and pressed states; transitions use the motion tokens (150 to 300 ms) and stop under reduced motion.
- [ ] Loading shows a skeleton the shape of the content; an empty list shows an `EmptyState` with its next step; an error says what went wrong and how to fix it.
- [ ] Filters, tabs and the period keep in the address, so a page can be shared and reloaded as it was.
- [ ] Charts have a legend and Show the numbers beside them.

## Every stage tests

- [ ] Hindi at 390 px: no horizontal overflow, chips and tiles wrap or truncate with the full text on hover or focus.
- [ ] Outdoor theme: each new colour pairing is in the token tests' contrast list and passes.
- [ ] Empty, one-row and long-value cases: a 40-character name, ₹1,23,45,678 and 1,443 rows don't break a row, tile or chip.
- [ ] A tenant brand colour other than the default: selected rows, rings and chips follow `deriveAccent()`.
- [ ] axe is clean in Playwright on every changed page; touch targets are at least 44 px on the phone.
- [ ] Every new component has its card in the design system, in both places, read back byte for byte.
