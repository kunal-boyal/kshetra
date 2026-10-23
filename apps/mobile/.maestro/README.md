# Maestro flows

The field app's end-to-end flows (spec 14.4, decision D68), on an Android emulator against the local API. CI runs them on main, every night, and on pull requests that change them (`.github/workflows/maestro.yml`).

Each run starts from a fresh fictional tenant: one field user nobody has signed in yet, and a place of theirs near the emulator's location. Seeded people are never signed in on a test device. Sign-in codes go to the local Mailpit inbox (`OTP_PROVIDER=mailpit`), where the flows read them.

## Running them here

Once: Android's command-line tools, JDK 17 and Maestro, and for an emulator its Android 15 system image. Then:

```bash
# In .env: OTP_PROVIDER=mailpit, and for an emulator CELL_API_URL=http://10.0.2.2:3000
docker compose up -d && pnpm dev
pnpm --filter @thelamp/api e2e:fixtures              # on a phone on a cable: --near none
cd apps/mobile
# An emulator reaches the API at 10.0.2.2; a phone on a cable at 127.0.0.1, through adb.
export APP_VARIANT=e2e EXPO_PUBLIC_DIRECTORY_URL=http://10.0.2.2:3000
pnpm exec expo prebuild --platform android --no-install
git checkout -- package.json                          # prebuild rewrites the scripts
(cd android && ./gradlew assembleRelease)             # in the same shell: Gradle bundles the JavaScript
.maestro/run.sh android/app/build/outputs/apk/release/app-release.apk
```

The `e2e` build (`com.thelamp.app.e2e`) installs beside the others and is the only one allowed to reach an API over plain HTTP. Make new fixtures before each run: a run signs the fixture's person in on that phone. After changing `EXPO_PUBLIC_DIRECTORY_URL`, delete `android/app/build/generated/assets` and Metro's cache (`$TMPDIR/metro-cache`), or the old address stays in the bundle.

On a real phone, the flows use its own GPS (the app refuses mocked locations), so the place is made without a location (`--near none`) and starting the day needs a fix near a window. A phone on a cable reaches the API through adb, which airplane mode can't cut, so the offline flow skips its check that work waits.

| Flow | What it proves |
|---|---|
| `flows/sign-in.yaml` | A code by SMS (here, Mailpit) signs a field user in |
| `flows/start-day.yaml` | Starting the day with consent and a location; tracking runs |
| `flows/visit-with-photo.yaml` | Checking in at a place, filling its form with a photo, sending it, checking out |
| `flows/offline-queue.yaml` | A pause saved without signal waits in the upload queue, then drains |
