# Decisions waiting for confirmation: D35 to D69

Each was merged as proposed and is in force. Confirming them settles phase 1's foundations before phase 2 builds on them. The full text of each is in [decisions.md](decisions.md); this page says in a line what each decides and which parts are judgement calls worth your eye. To change one, say so: a new decision supersedes it.

Reply with "confirm all", or name the ones to discuss.

## Shells and foundations

| Decision | What it decides | Worth your eye |
|---|---|---|
| D35 The web shell | The web never holds a refresh token: it lives in an httpOnly cookie, and a reload restores the session from it. | That the web signs in on the same phone-and-code flow as the app. |
| D36 The mobile shell | Expo SDK 57 with React Native's New Architecture and Expo Router; the session and device key in the secure store. | Android first; iPhone builds wait for the Apple account. |
| D37 Contract test and OpenAPI | Every route declares who may call it and what it takes and gives; the cross-tenant test and the OpenAPI document are built from that. | None: it guards tenancy. |
| D38 The phase 1 plan | The 17 steps of phase 1; until phase 2's workflow engine, a field user's proposals are approved by their manager. | Manager-only approval until phase 2. |
| D39 Background work | Queues on BullMQ and Redis; a worker and a scheduler beside the API; jobs per tenant on the tenant's clock. | None. |
| D40 Offline sync | Phones keep their data through sync pulls and an outbox; row versions are transaction IDs so nothing is skipped. | That a full re-copy happens after a database restore (SYNC_EPOCH). |

## People, places and forms

| Decision | What it decides | Worth your eye |
|---|---|---|
| D41 People on the web | Custom user fields, dated transfers, the organisation chart and each person's history. | A retired field keeps its key and values. |
| D42 Imports and territories | Files kept in the object store; an import writes every row or none; names matched without guessing. | The API's error texts are English only for now (open item). |
| D43 Accounts | Account types as versioned configuration; who sees an account; field users propose places, managers approve. | Who may create account types (settings managers). |
| D44 Photos | Phones upload straight to storage with checksums; a stamped copy with time and place; duplicates flagged; read through signed links. | The stamp's content, and the 12-month photo retention (D9). |
| D45 Forms and the catalogue | Forms published as versions that keep keys and field types; the catalogue arrives through an item import, without prices. | Prices wait for phase 2. |
| D46 Forms on the phone | Drafts kept per form version; submitted entries read only; signatures as drawn strokes. | None. |

## The field day

| Decision | What it decides | Worth your eye |
|---|---|---|
| D47 Shifts and tracking (server) | Punch rules, how location points are judged, daily partitions, trails and attendance from shifts. | Old points stay until the archive lands (being built now). |
| D48 Tracking on the phone | Punches work offline; the consent text; tracking stops when the person stops it and never restarts by itself. | The consent wording, which people read before every first punch-in. |
| D49 Visits and submissions (server) | How a record captured in the field is judged: shift, geofence, photo rules; submissions never change. | Outside-the-geofence is advisory by default (flagged, not refused). |
| D50 Visits and forms on the phone | Check in and out and forms in a visit, all offline, sent in order. | None. |
| D51 Review on the web | Who reviews whose work; notes required to reject; optional auto-approval after a delay. | Whether auto-approval is on for the pilot. |
| D52 Review on the phone | Managers review in a Team tab; reviews go straight to the server. | None. |

## Plans, targets and performance

| Decision | What it decides | Worth your eye |
|---|---|---|
| D53 Journey plans | Routes, plan items and a month's plan that can need the manager's approval. | Whether the pilot tenant approves months (a setting). |
| D54 Today's plan on the phone | Each person's plan items kept on the phone; Home shows today's. | None. |
| D55 Targets and account plans | Metric definitions stored from the template; targets set by managers, locked, unlocked with a reason. | Nobody sets their own targets. |
| D56 The metric engine | Daily facts per person rebuilt from records; scores and ranks worked out on reading; ranking groups by designation. | Leaderboards show as indicative until the month closes. |
| D57 My month on the phone | Metric tiles on Home and the leaderboard screen. | None. |

## Notifications, maps and reports

| Decision | What it decides | Worth your eye |
|---|---|---|
| D58 Notifications | Push first, then SMS or email when push can't reach; quiet hours; an inbox. | SMS costs money per message; which events may use SMS. |
| D59 Push on the phone | Push through Expo and Firebase; a tapped notification opens its screen. | None. |
| D60 Maps on the web | Google Maps for the live map, account pins, the day's replay and visit density; the live map read every 30 seconds. | Google Maps billing: the budget alert is an open item. |
| D61 Maps on the phone | The visit's map card, today's route and Team's on-duty map. | Try it on a phone (open item). |
| D62 Reports and exports | Three reports on screen and as XLSX or CSV; exports kept 7 days, readable by the requester only, every download audited. | The 7-day keep. |
| D63 The home dashboard | One read per Home: tiles, trend, leaderboard and what waits, by role. | None. |

## Administration and readiness

| Decision | What it decides | Worth your eye |
|---|---|---|
| D64 Tenant administration | Settings, logo and brand colour (with an accessible accent worked out from it), terminology and modules. | A brand colour too light for white text is refused. |
| D65 Configuration screens | Account types, territory levels, metrics and the score edited in the portal; metric changes rebuild people's figures from a chosen day. | Up to 92 days back; months only for targets. |
| D66 Configuration export and import | The configuration as a template-shaped file; importing adds and updates, never removes; a new tenant can start from a file. | Identity and secrets never travel in the file. |
| D67 Pilot readiness, part one | One container image, Terraform for a lean cell in Mumbai, deploys after CI, MSG91 for SMS through DLT templates. | The lean cell's size and cost, and the AWS account layout. |
| D68 Pilot readiness, part two | Maestro flows in CI, k6 load tests, the runbooks; the phone run's three fixes. | None. |
| D69 The location archive and retention | Raw points archived as Parquet by tenant and day after 8 days, deleted after the raw retention; trails and archive files after the trail retention; empty partitions dropped; evidence photos and their stamped copies removed after their keeping time. | Archive files kept as long as trails (your choice); photo files restorable for 30 days after removal. |
