# Tenant admin SOPs

For the people who set up and run their organisation in the web portal: the first admin the vendor added, and anyone later given the Admin or Business head role. These SOPs follow the order a new admin meets the work: signing in, the organisation and its words, who may do what, the geography, people and accounts, then the commercial and field configuration, and last the organisation's security and data. Settings live under **Settings** in the portal's rail, in six groups: **Organisation**, **People and access**, **Field work**, **Commerce**, **Data** and **Developers**.

| SOP | What it is for | Who |
|---|---|---|
| [Sign in to the portal for the first time](first-sign-in.md) | Mobile number and code, setting up the authenticator, recovery codes, your own sessions | First admin |
| [Set up the organisation and its brand](organisation-and-branding.md) | Display and legal names, GSTIN, address, time zone, privacy link, logo and brand colour | Admin, Business head (`settings.manage`) |
| [Switch modules on and off](modules.md) | What each module brings, plan limits, the opt-in modules | Admin, Business head (`module.manage`) |
| [Use your organisation's own words](terminology.md) | Your words for accounts, field users, plans, orders and the rest | Admin, Business head (`terminology.manage`) |
| [Set up roles and designations](roles-and-designations.md) | What people may do and whose records they reach; job titles and their default roles | Admin, Business head (`role.manage`, `designation.manage`) |
| [Keep extra details about people](people-fields.md) | Your own fields on each person's profile | Admin, Business head (`settings.manage`) |
| [Build the territory tree](territories.md) | Territory levels and the territories under them | Admin, Business head (`territory.manage`) |
| [Define account types](account-types.md) | Each kind of account: codes, locations, slots, fields, segments | Admin, Business head (`settings.manage`) |
| [Add and look after people](people.md) | Adding, changing, transferring and deactivating people; phones, sign-outs, seats | Admin, Business head (`user.manage`); Manager for phones and sign-outs |
| [Import records from a spreadsheet](imports.md) | People, territories, accounts, items, targets and account plans from a file | Admin, Business head, Back office (`import.run`) |
| [Add accounts and approve proposals](accounts.md) | Adding accounts, who looks after them, approving accounts and locations proposed from phones | Admin, Business head (`account.manage`); Manager to approve (`account.approve`) |
| [Catalogue and price lists](catalogue-and-price-lists.md) | Items, products and categories; price lists and prices | Admin, Business head (`catalogue.manage`, `price_list.manage`) |
| [Schemes](schemes.md) | Discounts, slabs and free goods on orders | Admin, Business head (`scheme.manage`) |
| [Forms](forms.md) | Building and publishing the forms people fill in the field | Admin, Business head (`form.manage`) |
| [Metrics and the score](metrics-and-score.md) | What is measured and how people are scored | Admin, Business head (`metric.manage`) |
| [Dashboards](dashboards.md) | Each role's Home | Admin (`dashboard.manage`) |
| [Approval chains](approval-chains.md) | Who approves each kind of request | Admin, Business head (`workflow.manage`) |
| [Calendars and holidays](calendars-and-holidays.md) | Weekly offs and holidays | Admin, Business head (`calendar.manage`) |
| [Leave types](leave-types.md) | Leave types, quotas, accrual and carry-forward | Admin, Business head (`leave_type.manage`) |
| [Expense policies](expense-policies.md) | What may be claimed, rates and caps | Admin, Business head (`expense_policy.manage`) |
| [Rules](rules.md) | Field rules: geofence, tracking, phones, review, keeping records | Admin, Business head (`settings.manage`) |
| [Set up sign-in security and single sign-on](security-and-sso.md) | The sign-in overview, step-up, OIDC or SAML sign-in and proving domains | Admin, Business head (`settings.manage`) |
| [Approve or end vendor support access](vendor-support.md) | Deciding the vendor's requests to enter, watching and ending access | Admin, Business head (`settings.manage`) |
| [Check your plan, billing details and invoices](billing.md) | Plan, seats, billing details, invoices and usage | Admin (`billing.manage`) |
| [API clients and webhooks](api-clients-and-webhooks.md) | Connecting other systems through the public API and webhooks | Admin (`api_client.manage`, `webhook.manage`) |
| [ERP connections](erp-connections.md) | Zoho Books, SAP Business One and Tally | Admin (`erp.manage`) |
| [Answer a personal data request](data-requests.md) | Copies, corrections and erasure of a person's data | Admin, Business head (`settings.manage`) |
| [Read the audit log](audit-log.md) | Who changed what, when and from where; exporting it | Admin, Business head (`audit.view`) |
| [Export all your organisation's data](data-export.md) | The signed archive of everything your organisation holds | Admin, Business head (`settings.manage`) |
| [Export and import the configuration](configuration-export-import.md) | Moving your configuration between environments as a file | Admin, Business head (`settings.manage` and the configuration permissions) |

Roles named here are the templates' starting roles. Your organisation may have renamed them or added its own; what counts is the permission in brackets.
