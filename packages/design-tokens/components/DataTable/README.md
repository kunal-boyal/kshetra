# DataTable

The data table is the web portal's workhorse for registers, orders, users and accounts: compact rows, tabular figures, cursor paging.

## Rules
- A `radius-lg` container on `shadow-sm`. `row-compact` (40) rows; header in `label-sm` on `surface-sunken`; sticky header gains `shadow-md` once scrolled. Rows shade to `surface-sunken` on hover (`duration-fast`).
- Numbers right-aligned in `numeric` with tabular figures; codes in `mono`; statuses as StatusBadge.
- Selected row: `accent-subtle`. Hover: `surface-sunken`. In Outdoor a selected row also gets a 2 px `accent` frame, because a tint alone is invisible in glare.
- Cursor paging, as the API pages (`?limit=50&cursor=…`, spec 11.1): a Load more button, no page numbers, and no total unless the API returns one.
- Custom columns from account-type fields follow fixed columns, in admin-defined order.
- Exports run as background jobs within the viewer's scope (M18). After Export, say "Preparing your export. The download link will appear here and in your email." Links expire after 7 days.

## The consumer provides
Column definitions (key, resolved header, alignment, formatter), rows for the current cursor, the selection model and empty-state copy.
