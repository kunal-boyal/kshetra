# PeriodStepper

A period stepper shows the month a page is about, with a step either side. It takes the place of a month input on pages that look at one month at a time.

## Anatomy
`ks-period`, a pill `control-sm` high:
- previous and next buttons with chevrons, named "Previous month" and "Next month";
- the month in `label` weight, read out when it changes.

## The consumer provides
The `YYYY-MM` value, a formatter in the reader's language ("October 2026", "अक्टूबर 2026"), the labels, and the first and last months there are.

## Rules
- Stepping past the last month (usually this one) is disabled, not hidden.
- The month also goes in the page title and the address, so a page can be shared as it is.
- Outdoor draws a 2 px edge.
