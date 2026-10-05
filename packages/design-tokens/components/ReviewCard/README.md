# ReviewCard

The review card puts everything a reviewer needs to judge one submission on one card: who, when, where, what, photos and flags.

## Anatomy
Form name and version · user and account · status · capture and receive times (tenant timezone) · GPS accuracy and distance · field values · flags · photo strip (each photo tagged with source; gallery photos tagged in `waiting`) · map with geofence ring, account point and submission marker · actions.

## The consumer provides
The submission with its evidence, the resolved field labels, and the reviewer's permission. The card hides actions for the reviewer's own work (and the server refuses them).

## Rules
- Reject requires a note of at least 3 characters, asked in a small sheet.
- Keyboard: A approve, R reject, J/K next/previous, shown on the card.
- Flagged cards can't be bulk-approved; clean ones show a checkbox.
- Photos open full-screen with time, place and distance from the submission.
