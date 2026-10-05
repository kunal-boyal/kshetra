# StatusBadge

A status badge shows one record's state as a word with a coloured dot; the word is the meaning, the colour is for scanning.

## Mapping (fixed across tenants)
| Variant | States |
|---|---|
| `success` | approved, accepted, present, completed, fulfilled |
| `pending` | pending, draft (targets), queued |
| `waiting` | at a later approval step ("Step 2 of 3"), partially accepted, partially fulfilled |
| `info` | planned, visited |
| `danger` | rejected, absent, parked (refused by server) |
| `neutral` | cancelled, inactive, missed, auto-closed, discarded |

## The consumer provides
The translated state label (from the state machine in Appendix C), and the variant from the mapping above — never chosen ad hoc. Use `label-sm`.

## Rules
- Never render the dot without the word, even in dense tables.
- Auto-approved records read "Approved · auto", not a different colour.
- A badge is not a button. Filtering by status uses chips, not badges.
- In Light and Dark the badge is a soft pastel pill with no visible edge: its `-border` matches its `-bg`.
- In Outdoor the badge is outlined: a white fill with a 1 px outline in its `-fg`, so the shape holds in glare where a tint would wash out. The tokens do this, and nothing changes in markup.
