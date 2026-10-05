# BottomNav

The bottom tab bar is the mobile app's top-level navigation: Home, Plan, Orders, Team and Me, filtered by permissions and modules.

## Rules
- Field users see four tabs (Orders only when the module is on); managers add Team. Never more than five.
- The bar has `radius-xl` top corners. Active tab: `accent-subtle-fg` label and icon on an `accent-soft` pill, which grows in on `ease-spring` (`duration-base`) when the tab changes. Inactive: `text-muted`. In Outdoor the active pill also gets a 2 px `accent` ring and the label goes to weight 700, because inactive labels are dark there too.
- Count badges (approvals waiting) in `danger-solid` with `on-danger`, capped at "99+". A badge pops in (`ks-pop`) when its count first appears.
- Labels always visible (`label-sm`), never icon-only. Each tab is at least `touch-min` wide. Visit, form and camera screens hide the bar.
