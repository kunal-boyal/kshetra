# ReviewCard

The review card puts everything a reviewer needs to judge one submission on one card: who, when, where, what, photos and flags.

## Anatomy
Form name and version · user and account · status · capture and receive times (tenant timezone) · flags as `ks-flag` (`danger` for a repeated photo or a failed integrity check) and the geofence as `ks-pill inside` or `outside` · field values in `ks-dl` · photo strip of `ks-photo wide` tiles (112 × 84), each tagged with its time and distance, then a `ks-mapbox` tile of the same size with the geofence ring and the check-in dot · the note, always shown, named for the person · actions in `ks-actions`.

On the web the card sits beside the review queue (SplitDetail), as the detail of the chosen row.

## The consumer provides
The submission with its evidence, the resolved field labels, and the reviewer's permission. The card hides actions for the reviewer's own work (and the server refuses them).

## Rules
- Reject, and any change of decision, requires a note of at least 3 characters; the note field is always on the card.
- Keyboard: A approve, R reject, J/K next/previous, shown on the card.
- Flagged submissions are never bulk-approved; the queue's "Approve N clean" approves the clean waiting ones after asking.
- Photos open full-screen with time, place and distance from the submission.
