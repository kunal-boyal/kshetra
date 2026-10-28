# ShiftCard

The shift card on mobile Home shows whether the user is on duty and holds the start, pause and end actions.

## States
- Off duty — `ks-live off`, "Off duty", one primary `Start day` (`term.punch_in`). Tapping opens the consent sheet.
- On duty — green live dot, "On duty since 09:12", Tracking badge (`success`), then three stats across, each a `metric-md` figure over its `ks-meta` word: time on duty, distance (counted on the phone, so "travelled, about") and today's visits. Pause as secondary, End day as tonal.
- Paused — badge `pending` "Paused", Resume as primary.
- Tracking stopped unexpectedly — badge `danger` "Not recording" and a fix-it link to device health.

## The consumer provides
Shift state from local storage (works offline), the times, the resolved punch terms, and the tracking line from the copy table.

## Rules
End day asks for confirmation only if items are unsent. The tracking explanation is never hidden. The distance is the phone's own count, a step added only past its fix's accuracy and at least 25 m; the server's trail stays the record.

## Motion
While on duty, the live dot pulses once per `duration-loop`. The pulse stops on entry-level phones (`data-motion="lite"`) and under reduced motion. Starting the day plays the ring ripple from the README's Motion section once, in place of the dot.
