# Licences for dedicated installs

A dedicated install (spec 9.5, decision D4) runs in licence mode: a signed file states the tenant it serves, its user cap, its modules and its expiry, and the install checks it offline (spec M23, BR-49, decision D90). The vendor's private key signs licences and never leaves the vendor; installs get the public key only.

## Once: the vendor's key pair

1. On a vendor laptop, outside the repository: `pnpm licence keys --out <folder>`. It writes `licence-private.pem` (readable by its owner only) and `licence-public.pem`.
2. Keep the private key in the vendor's password manager or a hardware-backed vault, with a second copy held by another platform admin. Never commit it, paste it into a chat, or put it on a server.
3. The public key goes to every dedicated install as `LICENCE_PUBLIC_KEY` (the PEM text).

Losing the private key means signing every install's next licence with a new pair and giving each install the new public key.

## Each licence

1. Agree the terms with the customer: the user cap (people active at once), the modules (`core` always), and the expiry date, normally the end of the paid year.
2. Sign it: `pnpm licence sign --key <licence-private.pem> --tenant-id <uuid> --slug <slug> --users <n> --modules core,orders,... --expires <YYYY-MM-DD> --out <slug>.licence`. The tenant ID is the install's own tenant's.
3. Check it as the install will: `pnpm licence check --public-key <licence-public.pem> --file <slug>.licence`.
4. Send the file to the customer's operator. On the install, put it at `LICENCE_FILE_PATH` and restart the API: a file that doesn't check out stops it starting, and the old licence keeps working until then.
5. Record the licence ID, terms and date in the licence log.

## Expiry

The licence works to its expiry date and for 30 days after; the install logs a warning at start-up during those days. After them the tenant can only read (`TENANT_READ_ONLY`) until a renewed licence is in place. Renew a month ahead.
