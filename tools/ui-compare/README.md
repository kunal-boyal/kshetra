# ui-compare

Screenshots each artboard of the approved product prototype beside the portal page that answers to it, for the UI revamp (phase U, decision D104). Each stage reruns it and Kunal reviews the gallery it writes.

```bash
pnpm --filter @thelamp/ui-compare compare --phone <a demo person's number>
```

- The portal, the API and Mailpit must be running (`pnpm dev` with `OTP_PROVIDER=mailpit`); the number signs in on the web once, with its code taken from Mailpit, so use a manager or admin of a demo tenant with data, such as one `demo:content` filled.
- The console's pairs (`console-*`, stage U12) sign in to the console (`--console`, default http://127.0.0.1:5174) as a platform admin made for the run with `pnpm invite-staff`; its setup link, password and authenticator secret stay in the process (`src/staff.ts`). Run them against a local directory only; each run leaves its staff member there, named UI comparison.
- `--only home,leaderboard` takes keys from `src/pages.ts`; `--prototype-only` skips the portal; `--out` picks the folder (default `out/<date and time>`, git-ignored).
- It writes Light and Dark at 1440 and 390 px for both sides, and `index.html`, the gallery, which opens in a browser or publishes as an artifact with the images beside it.

## The prototype copy

`prototype/` is a copy of the prototype artifact (https://claude.ai/artifact/5gU3wR97hjoXsho2q7qZGj) at version `1793109473-f336`, taken on 2026-10-27: its artboards (`*.dc.html`), `canvas.json` and the design system copy its pages load. It is the reference the revamp builds to, so it changes only when Kunal changes the prototype; then copy the new version in and note it here.

`src/render.ts` draws an artboard as plain DOM by the format's rules (holes, `sc-for`, `sc-if`, `dc-import`, `renderVals()`), and `src/cli.ts` serves it to the browser with its types stripped. The prototype's one image, the mark, is served from `packages/design-tokens/assets/Logos/mark.webp`.

## Adding a pair

Add an entry to `PAIRS` in `src/pages.ts`: the artboard, the portal path (or a list whose nth row to open, with a suffix), and the stage. The console's pairs join with stage U12 and the phone's with M1, each needing its own way to sign in.
