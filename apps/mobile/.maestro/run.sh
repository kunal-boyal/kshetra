#!/usr/bin/env bash
# Runs the Maestro flows on the running emulator (decision D68): installs the e2e build, lets the
# emulator reach this machine's API and Mailpit, and passes the run's fixtures to every flow.
#   apps/mobile/.maestro/run.sh <path to app-release.apk> [flow...]
set -euo pipefail
# Maestro reports usage to its makers unless told not to.
export MAESTRO_CLI_NO_ANALYTICS=1

here="$(cd "$(dirname "$0")" && pwd)"
apk="${1:?Give the path of the e2e APK}"
shift
flows=("$@")
[[ ${#flows[@]} -eq 0 ]] && flows=("$here")

adb wait-for-device
adb install -r -g "$apk"
# Tracking needs location all the time, which installing with -g doesn't grant; a person chooses
# "Allow all the time" for it.
adb shell pm grant com.kshetra.app.e2e android.permission.ACCESS_BACKGROUND_LOCATION
adb reverse tcp:9000 tcp:9000 # MinIO, where photos upload straight to (decision D44)

# An emulator reaches this machine's API over its own network (10.0.2.2), which its airplane mode
# cuts, so the offline flow is offline; a phone on a cable reaches it through adb, which airplane
# mode can't cut, so there the flow skips the wait it can't see.
emulator=false
[[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" == "1" ]] && emulator=true
[[ "$emulator" == false ]] && adb reverse tcp:3000 tcp:3000

env=()
while IFS='=' read -r key value; do
  [[ -n "$key" ]] && env+=(-e "$key=$value")
done <"$here/.env"

# The app refuses mocked locations, and Maestro's setLocation is one, so an emulator's own GPS
# reports the fixtures' place instead, every few seconds so a fresh fix is always on its way. A real
# phone uses its own GPS.
if [[ "$emulator" == true ]]; then
  lat="$(sed -n 's/^LAT=//p' "$here/.env")"
  lng="$(sed -n 's/^LNG=//p' "$here/.env")"
  (while true; do
    adb emu geo fix "$lng" "$lat" >/dev/null 2>&1 || true
    sleep 3
  done) &
  geo=$!
  trap 'kill "$geo" 2>/dev/null || true' EXIT
fi
env+=(-e "EMULATOR=$emulator")

maestro test "${env[@]}" "${flows[@]}"
