// `pnpm db:seed`: two fictional tenants for local work and CI (spec 9.4). It refuses any database
// that isn't on this machine, and running it again changes nothing.
import { createCommandContext, report } from './context';
import { assertSeedable, seed } from './db/seed';

const { app, config } = await createCommandContext();
try {
  assertSeedable(config);
  const result = await seed(app);
  for (const slug of result.existed) console.log(`Tenant ${slug} is already seeded.`);
  for (const slug of result.created) console.log(`Tenant ${slug} is seeded.`);
  if (result.people.length > 0) {
    // The numbers are made up and the seed runs only locally, so they are printed in full.
    console.log(
      '\nPeople (sign in with POST /auth/v1/otp/request; the code prints in the API console):',
    );
    for (const person of result.people) {
      console.log(
        `  ${person.tenant.padEnd(8)} ${person.name.padEnd(16)} ${person.phone}  ${person.role} (${person.designation})`,
      );
    }
  }
} catch (error) {
  report(error);
} finally {
  await app.close();
}
