# Set up the organisation and its brand

| | |
|---|---|
| **Who** | Admin (`settings.manage`) |
| **Where** | Web portal › **Settings** › **Organisation** › **Organisation** |
| **Module** | Core |
| **Related** | [Switch modules on and off](modules.md), [Use your organisation's own words](terminology.md), [Set the organisation's rules](rules.md), [Export and import the configuration](configuration-export-import.md) |

The Organisation page holds your organisation's name, legal details, logo, colour and time zone, as people see them in the apps and on exports. Set it up first, before you add people.

## Before you start

- You are signed in as an admin ([Sign in to the portal for the first time](first-sign-in.md)).
- Have your logo as a PNG, JPEG or WebP file of 2 MB or less.
- Have your brand colour as a colour code, such as one from your style guide.

## Steps

1. Open **Settings**. It opens on **Organisation** › **Organisation**.

### Logo

2. Under **Brand**, **Logo**, select **Add a logo** (or **Replace the logo**) and choose the file. It uploads straight away and is resized to fit 512 pixels; you don't need to select **Save** for it.
3. To take it away, select **Remove the logo**.

### Brand colour

4. Under **Brand colour**, type the code in **Colour code**, or select **Pick a colour** and choose one.
5. Look at **How it looks**: a sample **Start day** button and a **Selected** chip in your colour.
6. If the page says **Too light: white text on it would be hard to read.**, select the **Use {colour} instead** button it offers, which names a shade. It is the nearest darker shade that passes.
7. To go back to the product's own colour, select **Go back to the product colour**.

### Names, address and time zone

8. **Display name** (required): the name shown in the apps and at sign-in. People see a new name the next time they sign in.
9. **Legal name**: your company's registered name.
10. **GSTIN**: 15 characters. It is printed on exports.
11. **Registered address**.
12. **Time zone**: your organisation's clock. Each person's day, punch times, months and reports follow it.
13. **Your privacy policy**: an `https://` address. The app's Privacy screen links to it beside the product's own notice.
14. Select **Save** at the bottom of the page. It is available only once something has changed and the colour passes. The page says **Saved.**

### The rest of the page

- **Your words** lists the product's word for each term beside yours, in English and Hindi. Select **Change words** to change them ([Use your organisation's own words](terminology.md)).
- **Modules** shows whether each module is **On** or **Off** (Core is **Always on**). Nothing is switched here: select **Change modules** to switch them on the Modules page, the one place that knows your plan and switches **Inventory** and **Statutory payroll** on ([Switch modules on and off](modules.md)).
- **Field rules** sums up the **Geofence**, **Auto-approval**, **Tracking**, **Phones** and **Photo keeping** rules. Select **All rules** to change them ([Set the organisation's rules](rules.md)).
- **Export configuration** opens **Export and import** ([Export and import the configuration](configuration-export-import.md)).

## What the system checks

- The brand colour must have a contrast of at least 4.5 to 1 with white text, so buttons stay readable. The apps derive every accent shade from it, in every theme (`deriveAccent()`). A colour close to one the apps use for a status still colours buttons, and the page notes that it never shows a status on its own.
- The logo must be a PNG, JPEG or WebP image of 2 MB or less.
- Display name up to 120 characters, legal name up to 200, address up to 500, GSTIN 15 characters.
- Save sends only what changed, and every change is in the audit log as `settings.updated`.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This image is larger than 2 MB. Choose a smaller one. | The logo file is too big. | Make the image smaller and choose it again. |
| Too light: white text on it would be hard to read. | The colour fails the contrast check. **Save** stays unavailable. | Select the **Use {colour} instead** button, or choose a darker colour. |
| Some details need fixing. Check the highlighted fields. | A field is wrong, such as a GSTIN of the wrong length or a privacy address that isn't `https://`. The field says what. | Correct the field and select **Save** again. |
| You don't have access to this. | Your role lacks `settings.manage`. | Ask an admin. |
