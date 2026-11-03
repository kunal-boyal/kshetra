# Lay out each role's Home

| | |
|---|---|
| **Who** | Admin (`dashboard.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Dashboards** |
| **Module** | **Advanced analytics** |
| **Related** | [Set up metrics and the score](metrics-and-score.md) |

Each role's Home in the portal can be laid out from cards: metric tiles, a day-by-day trend, a metric split by person or territory, and the standard cards. A layout chooses what a role sees first; it never widens what anyone may see. Everyone still sees only their own figures or their team's, and only what their permissions allow.

## Before you start

- The **Advanced analytics** module is on. Without it, **Dashboards** is not in the menu, and every role keeps the standard Home.
- The metrics you want to show are in use. See [Set up metrics and the score](metrics-and-score.md).
- In the default templates only the Admin role holds `dashboard.manage`.

## Steps

1. Open **Settings** › **Field work** › **Dashboards**.
2. Choose the **Role**. A role that already has a layout shows as, for example, "Manager (laid out)".
3. A role without a layout sees the standard Home ("Manager sees the standard Home"). Select **Lay out this Home** to start from the standard Home's cards: metric tiles, a trend, **Leaderboard**, **Who is on duty**, **Waiting for you** and **Forms filled**.
4. Change the cards:
   - **Metric tiles**: tick the **Metrics, up to 8** to show as tiles.
   - **Day-by-day trend**: tick the **Metrics, up to 4**. Only metrics whose days add up are offered.
   - **A metric by person or territory**: choose the **Metric** and **Split by** (**Person** or **Territory**). By territory, choose the **Level**.
   - **Forms filled**, **Leaderboard**, **Who is on duty** and **Waiting for you** have no settings; the card says what it shows. Each may be on a Home once.
5. Use the arrow buttons beside each card to move it up or down, and the bin button to take it out. Screen readers name them, for example, "Move card 2, Metric tiles, up" and "Take out card 2, Metric tiles".
6. To add a card, choose it in **Add a card**.
7. Select **Save the layout**. You see "Saved. Everyone with the Manager role sees this Home."
8. To go back to the standard Home, select **Use the standard Home**, then confirm. The layout is taken away.

The role's first **Metric tiles** card also sets which of a person's own metrics the phone's My month shows first.

## What the system checks

- Every metric and level a card names exists and is worked out (`dashboardLayoutIssues()`).
- A trend needs metrics whose days add up; a split by territory needs a metric whose people add up, and a level that exists. A split by person has no level.
- A metric is named once in a card. Each of the standard cards appears once.
- When a metric is retired later, cards naming it drop it on the Home.
- Each card follows the viewer's own scope: a manager sees their team, a field user their own figures. **Leaderboard** shows only to those who may see it, and **Who is on duty** only to those who see the live map.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A card broke a rule; the reason shows on that card, such as "This card is there already". | Fix or take out that card and save again. |
| This feature is switched off for your organisation. | **Advanced analytics** is off, by your admin or your plan. | Switch it on in **Settings** › **Organisation** › **Modules**, if your plan includes it (see [Switch modules on and off](modules.md)). |
| A metric is missing from the trend's choices | Its days don't add up (for example, a percentage). | Show it as a tile, or split it by person. |
