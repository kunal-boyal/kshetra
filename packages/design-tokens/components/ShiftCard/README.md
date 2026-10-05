# ShiftCard

The shift card on mobile Home shows whether the user is on duty and holds the start, pause and end actions.

## States
- Off duty — `ks-live off`, "Off duty", one primary `Start day` (`term.punch_in`). Tapping opens the consent sheet.
- On duty — green live dot, "On duty since 09:12", Tracking badge (`success`), on-duty time in `metric-md`, distance and visits, Pause and End day as secondary.
- Paused — badge `pending` "Paused", Resume as primary.
- Tracking stopped unexpectedly — badge `danger` "Not recording" and a fix-it link to device health.

## The consumer provides
Shift state from local storage (works offline), the times, the resolved punch terms, and the tracking line from the copy table.

## Rules
End day asks for confirmation only if items are unsent. The tracking explanation is never hidden.

## Motion
While on duty, the live dot pulses once per `duration-loop`. The pulse stops on entry-level phones (`data-motion="lite"`) and under reduced motion. Starting the day plays the ring ripple from the README's Motion section once, in place of the dot.
