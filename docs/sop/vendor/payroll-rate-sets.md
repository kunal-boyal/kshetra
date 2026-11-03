# Keep payroll rate sets

| | |
|---|---|
| **Who** | Finance or Platform admin (`platform.billing.manage`); every staff member reads the sets |
| **Where** | Console › **Billing** › **Payroll rates** |
| **Module** | Statutory payroll (in the tenants that switch it on) |
| **Related** | [docs/payroll/statutory-rates.md](../../payroll/statutory-rates.md), [the tenant admin's procedures](../admin/README.md) |

Statutory payroll works every tenant's payslips out on rate sets the vendor keeps: PF, ESI, professional tax, labour welfare fund and income tax figures, each set in force from a date. When the law changes, you add a new set; you never edit one. A chartered accountant's review of a set lifts the awaiting-review notice from the payslips worked out on it.

## Before you start

- What changed in the law, from which date, and the notification or source it rests on. The sources behind the current sets, and the items still to confirm, are in [docs/payroll/statutory-rates.md](../../payroll/statutory-rates.md).
- For a review: the chartered accountant's name and firm, and the date they signed it off.

## Read the sets

1. Open **Billing**, then **Payroll rates**.
2. Each set shows "{id}, from {date}", its PF wage ceiling and ESI wage limit, its notes, and **Reviewed** or **Awaiting review**, with each review recorded on it ("Reviewed by {reviewer} on {date}, rules version {version}").
3. Until the vendor adds a set of its own, a notice says these are the reference sets. A month's payslips use the set in force on the month's last day.

## Add a rate set

1. Under **Add a rate set**, **The rate set** already holds a copy of the latest set, with an empty ID, date and notes.
2. Give it a new `id` (up to 40 characters, such as one naming the month it starts), the `from` date it is in force from (`YYYY-MM-DD`), and change only the figures the law changed.
3. In `notes`, say what the set rests on: each source, and anything still to confirm.
4. Select **Add the set**. The console checks it before sending; when it is in, **Saved** shows and the set joins the list as Awaiting review.

The first set you add keeps the reference sets in the list beside it. Payslips already approved keep the figures they were worked out on.

## Record a chartered accountant's review

1. Under **Record a review**, choose the **Rate set** they reviewed.
2. Enter **Reviewer and firm** and **Reviewed on**, and, if useful, a **Note** (what they checked, or a reference to their letter).
3. Select **Record the review**. **Saved** shows, and the set says **Reviewed**.

A review counts for the rules' current version, which the help line names. When a release changes the payroll rules, the version rises and every set needs reviewing again; until then the payslips say they await review.

## What the system checks

- A set's shape: every rate the payroll rules need, with sensible values, before it is sent.
- Each set's ID is new. Sets are only ever added, never changed or removed.
- A review names a set that exists, and is recorded under the rules' current version.
- Adding a set and recording a review are recorded in the platform audit.
- Until a review covers the set in use, every pay run screen and payslip in the tenants says: "Awaiting review by a chartered accountant. Check these figures with your accountant before paying."

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This isn’t valid JSON. | The text isn't well-formed (a missing comma or quote) | Start again from the latest set's copy and change less at once |
| Under **The rate set**: a path and a message, such as `from: …` | That part of the set doesn't fit | Fix the named part |
| This changed somewhere else. Refresh and try again. | A set already has this ID | Choose another ID |
| This was not found. It may have been removed. | The review names a set that doesn't exist | Refresh and choose the set again |
| You don't see **Add a rate set** or **Record a review** | Your role can only read the sets | Ask Finance or a platform admin |

## Waiting on the owner

- A chartered accountant (or a payroll provider) to review the statutory payroll rules and the rate sets, including the items marked to confirm, before any tenant switches statutory payroll on (D128).
