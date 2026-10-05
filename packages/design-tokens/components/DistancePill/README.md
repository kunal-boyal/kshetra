# DistancePill

The distance pill shows the user's distance to an account and whether that is inside its geofence, on the visit map card and on review cards.

- `inside` — `success-*`, check icon, "Inside · 42 m".
- `outside` — `waiting-*`, pin icon, "Outside · 640 m". Under a `required` policy the check-in button is disabled and the help line says "Move within 300 m of this account to check in."

## The consumer provides
The evaluated result and distance (metres under 1 km, then "1.2 km"), with the GPS accuracy credit already applied (BR-33). Never compute inside/outside in the component.
