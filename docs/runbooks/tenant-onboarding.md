# Tenant onboarding

A new customer's tenant, from an industry template or from a configuration prepared elsewhere (spec 5.14, decisions D66 and D67).

1. **Agree the basics:** the tenant's name, its slug (part of its sign-in, never changed), the template (`generic` or `agri`), and the first admin's name and mobile number.
2. **Prepare the configuration** in staging if it needs work: provision there, shape it in Settings, then export it from Settings › Export and import.
3. **Provision** in production as a one-off API task ([deploy](deploy.md), step 5), from the template, or provision from the template and import the prepared file in Settings › Export and import. The tenant starts as `trial` unless `--status active` is given.
4. **First admin:** they sign in with their number and the code by SMS, then add people (or import them), territories and accounts (imports, M19).
5. **Phones:** field users install the app from Play (internal testing during the pilot), sign in with their numbers and accept the tracking consent at their first punch-in.
6. Record the tenant, its template version and the date in the onboarding log.
