# DataTable

The data table is the web portal's workhorse for registers, orders, users and accounts: compact rows, tabular figures, ten rows a page.

## Rules
- A `radius-lg` container on `shadow-sm`. `row-compact` (40) rows; header in `label-sm` on `surface-sunken`; sticky header gains `shadow-md` once scrolled. Rows shade to `surface-sunken` on hover (`duration-fast`).
- Numbers right-aligned in `numeric` with tabular figures; codes in `mono`; statuses as StatusBadge.
- Selected row: `accent-subtle`. Hover: `surface-sunken`. In Outdoor a selected row also gets a 2 px `accent` frame, because a tint alone is invisible in glare.
- A row that chooses what a detail beside it shows does so through a button in its first cell, styled as text with `ks-cell-link`, so it is reached by keyboard and named for screen readers.
- Ten rows a page (decision D106): under the table, "Showing 11–20" in `ks-meta` and Previous and Next as small secondary buttons (`ks-pager`). Next asks the API for its next cursor page (`?limit=…&cursor=…`, spec 11.1) when it runs past the rows loaded; no page numbers, and no total unless the API returns one. One page shows no pager. Rows off the page stay in the table, hidden (`ks-off-page`), so a printed sheet holds them all; the pager never prints.
- Custom columns from account-type fields follow fixed columns, in admin-defined order.
- Exports run as background jobs within the viewer's scope (M18). After Export, say "Preparing your export. The download link will appear here and in your email." Links expire after 7 days.

## The consumer provides
Column definitions (key, resolved header, alignment, formatter), every row loaded so far and whether the API has more, the selection model and empty-state copy.
