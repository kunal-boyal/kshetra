# SyncBanner

The sync banner sits under the mobile app bar and tells the field user what is still on the phone; tapping it opens the upload queue.

## States
- hidden — nothing waiting.
- `pending` (amber) — items waiting: "Offline. 7 items saved on this phone." or "Uploading 3 of 7".
- `danger` (red) — something was refused (`parked`): "2 items were refused. Retry or discard them." The queue holds each refused item with its last error until the user retries or discards it.
- `info` — system notices that must stay visible: support access sessions, read-only billing state.

## The consumer provides
The count and the state from the local queue; an action label (View, Open). Full width, min height `touch-min`, `z-sticky`.

## Rules
Never auto-dismiss. Never say "error" without saying what to do. The red state outranks amber; show only one banner.

In Outdoor the banner inverts: its status `-fg` becomes the fill, and the text, icon and action turn `text-inverse` at weight 600 (7:1 or more). A dark band under the app bar is the one thing glare can't hide.
