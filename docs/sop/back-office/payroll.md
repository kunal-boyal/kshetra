# Payroll

| | |
|---|---|
| **Who** | Payroll inputs: Back office, Business head, Admin (`payroll.manage`). Statutory pay run: Admin (`payroll.run`, and `salary.manage` for salary structures); the Back office role doesn't hold these by default |
| **Where** | Web portal › **Payroll**; **Pay run**; **People** › a person › **Salary** |
| **Module** | Payroll inputs; Statutory payroll (off until an admin switches it on) |
| **Related** | [Read the attendance register](../manager/attendance.md), [Pay expense claims](expense-payouts.md), [Import and export](imports-and-exports.md), [Reports](reports.md) |

The product offers two levels of payroll. **Payroll inputs** gives each person's monthly gross, their paid days from attendance and an attendance-based estimate of their pay, for whoever runs payroll. **Statutory payroll**, an add-on, works out a full pay run with PF, ESI, professional tax, the labour welfare fund and TDS, and freezes payslips once approved.

## Before you start

- Paid days come only from attendance ([Read the attendance register](../manager/attendance.md)): settle the month's leave and fixes first.
- Statutory payroll: an admin switches **Statutory payroll** on in Settings › **Modules**. Rates come from the vendor's dated rate sets, which the product applies by month; nobody types a rate.

## Steps

### Payroll inputs: set each person's gross

1. Open **Payroll** in the left rail. The heading is **Payroll · …**; choose the month with **Previous month** and **Next month**. The page carries the words: **Attendance-based estimate. This is not a statutory payroll document.**
2. Each row gives the **Person**, **Monthly gross** (**No gross yet** where none is set), **Paid days** (**… of …**: paid days of the month's scheduled working days), and **Estimate** (**so far this month** for the month under way).
3. To set or change a gross, choose **Set gross** on the row. Under **Monthly gross for …**, give the **Monthly gross** and **From month** (earlier months keep the gross they had). Choose **Save**, or **Cancel**.
4. To set many at once, import them: on **Imports**, choose **Monthly gross** under **Payroll** in **What to import** ([Import and export](imports-and-exports.md)); **Open payroll** then leads back here. The bulk API has no route for it.

### Payroll inputs: a payslip preview and the summary

1. Choose **Payslip** on a row. **Payslip preview · …** shows the **Monthly gross**, the **Paid days** by kind (**Present**, **Half days**, **Paid leave**, **Unpaid leave**, **Absent**, **Holidays**, **Weekly offs**) and **Provisional pay: …** (**Provisional pay so far: …** for the month under way). Choose **Print** to print it.
2. Choose **Export the summary** for the month's **Payroll summary** as a file, from **Reports** › **Your downloads**.

### Statutory payroll: salary structures and statutory details

Admin (`salary.manage`).

1. Open **People**, choose the person, and go to **Salary**.
2. Under **A new structure**, give **From month**, **Basic** and the allowances (**Dearness allowance**, **House rent allowance**, **Conveyance**, **Special allowance**). Choose **Save the structure**. **Salary structures** lists each with its **Monthly gross** and **Wages (PF and ESI)**. A structure applies from its month until the next.
3. Under **Statutory details**, give the **Work state** (where they work, for professional tax and the welfare fund), **UAN**, **ESI number**, and tick **PF member**, **PF on the full wage, not the ceiling**, **Women’s professional tax slabs** and **PAN on file with you** as they apply. Choose **Save the details**.
4. To enter many at once, import them: on **Imports**, choose **Salary structures** under **Payroll** in **What to import**, while statutory payroll is on ([Import and export](imports-and-exports.md)); **Open people** then leads to the people, whose **Salary** section shows them.

### Statutory payroll: run the month

Admin (`payroll.run`).

1. Open **Pay run** in the left rail. The heading is **Pay run for …**; choose the month.
2. Choose **Start the pay run**. It works out everyone with a salary structure for the month from their days, statutory details and adjustments. Nothing is final until you approve it.
3. **The month’s pay run** shows **Draft**, the rate set used (**Rates: …, in force from …**), **People paid** and **Employer’s contributions**. Each row gives the **Person**, **Gross earned**, **Total deductions**, **Net pay** and **Needs the accountant**: **Surcharge**, **No PAN**, **No work state** or **No structure**.
4. Choose **Payslip** to read one: **Draft: not yet approved**, the person's **UAN**, **ESI number**, **PAN** (**On file** or **Not on file**), **Work state**, **Paid days**, **Earnings**, **Deductions**, **Net pay: …** with **In words: … only**, and **Employer’s contributions**. **Print** prints it.
5. For arrears, an advance or any other one-off, choose **Add an adjustment**: **Choose a person**, the **Kind** (**Earning** or **Deduction**), a **Name** (lowercase letters, digits and _, such as arrears or advance), the **Amount** and **Why**. Choose **Add and work it out again**.
6. After changing attendance, structures or details, choose **Work it out again**.
7. When every figure is right, choose **Approve the pay run**. It asks **Approve the pay run for …?**: every payslip freezes and people can see their own. Choose **Approve the pay run** again, or **Cancel**.
8. Once approved, the payslips no longer change. Put a correction into a later month as an adjustment.

Pay out through your bank as usual; the **Pay register** report gives the month's figures.

## What the system checks

- The estimate is gross × paid days ÷ the month's scheduled working days, at most the whole gross, to the paisa; nothing scheduled earns nothing (BR-26, `provisionalPay()`). A part month and the month under way earn a part.
- The gross in force for a month is the latest change from or before it; a change earlier than the latest is refused (`grossOn()`).
- Statutory payroll (BR-56 to BR-58, `payslipFor()`): wages for PF and ESI follow the codes' 50% rule (`structureWages()`); pay is earned for paid days (`earnedFor()`); PF, ESI, professional tax, the labour welfare fund and TDS under the new regime come from the rate set in force (`pfFor()`, `esiFor()`, `ptFor()`, `lwfFor()`, `tdsFor()`).
- Approval is at the version you saw: if the run changed meanwhile, approve again after reading it.
- Audit entries never hold an amount; gross and payslips are personal data.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No gross yet | No monthly gross is set for the person. | **Set gross**. |
| No monthly gross for this month | The payslip preview has no gross for the month. | Enter one on the **Payroll** page. |
| No one has a salary structure for this month. | Nobody has a structure from this month or before. | Add structures under **Salary**, then **Work it out again**. |
| **No PAN**, **No work state**, **Surcharge** | The run left something out: TDS assumes a PAN; no professional tax or welfare fund without a work state; a surcharge above ₹50 lakh a year isn't taken. | Fix the details, or settle it with your accountant before paying. |
| This changed somewhere else. Refresh and try again. | The pay run changed since you read it, or it is approved already. | Reload, check it, then approve. |
| This feature is switched off for your organisation. | Payroll inputs or statutory payroll is off. | Ask your admin. |

## Waiting on the owner

- Statutory payroll awaits a chartered accountant's review of its rules and rate sets. Until then every pay run and payslip says **Awaiting review by a chartered accountant. Check these figures with your accountant before paying.** Don't switch it on for a tenant before that review.
