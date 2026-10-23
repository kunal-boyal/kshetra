# Device reset

A tenant with device binding on lets each person sign in on one phone (BR-38). A new or lost phone needs a reset (M1, spec 13.1).

- **Who:** the person's manager (within their scope) or an admin, from the web portal: People › the person › Reset device, after confirming. Nobody resets their own device.
- **What happens:** the next sign-in binds the new phone. The old phone's tokens fail at their next request, and its unsent records stay on it: ask the person to open the Upload queue on the old phone first, if they still have it.
- **Lost or stolen phone:** reset the device, then Sign out everywhere on the same page, which ends every session.
- **Support:** vendor staff never reset devices themselves; they ask the tenant's admin. Support access under a support grant arrives with the platform console (phase 3).
