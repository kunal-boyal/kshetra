# Device reset

A tenant with device binding on lets each person sign in on one phone (BR-38). A new or lost phone needs a reset (M1, spec 13.1).

- **Who:** the person's manager (within their scope) or an admin, from the web portal: People › the person › **Reset phone**, after confirming. Nobody resets their own device.
- **What happens:** the next sign-in binds the new phone. The old phone's tokens fail at their next request, and its unsent records stay on it: ask the person to open the Upload queue on the old phone first, if they still have it.
- **Lost or stolen phone:** reset the phone, then **Sign out everywhere** on the same page, which ends every session.
- **Support:** vendor staff enter a tenant only under a support grant its admin approved (Settings › Vendor support, decision D93). Under a **See and change** grant they hold `user.reset_device` and can reset a phone in the portal as an admin would, recorded in the audit log under the grant; under **See only** the reset is refused (`SUPPORT_READ_ONLY`). Ask the tenant's admin first, and reset under a grant only when the admin asks for it.
