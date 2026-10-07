/**
 * English, the language every other one falls back to (spec 8.6). Keys are stable: add new ones
 * and never reuse an old one for a new meaning.
 *
 * Placeholders:
 * - `{name}` is a parameter. Numbers are formatted for the locale; other values pass as given.
 * - `{term.account}` is a term in the tenant's words (spec 5.2). `:other` takes the plural, `:count`
 *   picks the form for the `count` parameter, and `:lower` lowercases a capitalised word for use
 *   mid-sentence, leaving acronyms as they are.
 * - A message with `one` and `other` forms picks one for the `count` parameter.
 */
export const en = {
  // Every error code of spec 11.4, as the apps show it (spec 8.4).
  'error.VALIDATION': 'Some details need fixing. Check the highlighted fields.',
  'error.UNAUTHENTICATED': 'Sign in to continue.',
  'error.TOKEN_EXPIRED': 'Your session needs refreshing. Try again.',
  'error.SESSION_REVOKED': 'You have been signed out. Sign in again.',
  'error.FORBIDDEN': "You don't have access to this.",
  'error.OUT_OF_SCOPE': 'This is outside the people and places you look after.',
  'error.MODULE_DISABLED': 'This feature is switched off for your organisation.',
  'error.USE_MOBILE_APP': 'Use the mobile app for this.',
  'error.NOT_FOUND': 'This was not found. It may have been removed.',
  'error.CONFLICT': 'This changed somewhere else. Refresh and try again.',
  'error.IDEMPOTENCY_CONFLICT':
    'This request was already sent with different details. Start it again.',
  'error.DEVICE_NOT_BOUND':
    'This phone is not registered for your account. Ask your manager to reset your device.',
  'error.ALREADY_PUNCHED_IN': 'Your day has already started.',
  'error.NOT_ON_SHIFT': 'You are not on duty. Tap {term.punch_in} first.',
  'error.OUTSIDE_SHIFT': 'This was recorded outside your duty hours, so it cannot be saved.',
  'error.SHIFT_EXPIRED': 'Your day passed the longest allowed shift and was closed.',
  'error.GPS_MOCKED':
    'Your location looks simulated. Turn off any app that changes your location, then try again.',
  'error.GPS_STALE': 'Your location is out of date. Wait for a fresh fix, then try again.',
  'error.GPS_INACCURATE':
    'Your location is not accurate enough. Move into the open, then try again.',
  'error.OUTSIDE_GEOFENCE': 'You are too far from this {term.account:lower}.',
  'error.SYNC_WINDOW': 'This was recorded too long ago to be counted.',
  'error.PHOTO_REQUIRED': 'Add a photo to continue.',
  'error.MEDIA_NOT_READY': 'A photo is still uploading. This will retry by itself.',
  'error.PRICE_CHANGED':
    'Prices have changed. Check your cart, then send the {term.order:lower} again.',
  'error.TARGET_LOCKED': 'This {term.target:lower} is locked and can no longer be changed.',
  'error.NOT_CURRENT_APPROVER':
    "It isn't your turn to act on this, or someone else already has. Refresh your inbox.",
  'error.QUOTA_EXCEEDED': 'This is over your limit.',
  'error.IMPORT_ERRORS': 'Some rows have errors. Fix them, then upload the file again.',
  'error.SEAT_LIMIT': 'Your organisation has used all its seats. Ask an admin to add more.',
  'error.TENANT_READ_ONLY':
    "Your organisation's subscription is read-only for now. Ask an admin about billing.",
  'error.TENANT_SUSPENDED':
    "Your organisation's subscription is suspended. Ask an admin about billing.",
  'error.RATE_LIMITED': 'Too many attempts. Wait a moment, then try again.',
  'error.SYNC_RESET': 'Your phone needs a full refresh. It is starting now.',
  'error.OTP_INVALID': 'That code is not right. Check it and try again.',
  'error.OTP_EXPIRED': 'This code has expired. Ask for a new one.',
  'error.UPGRADE_REQUIRED': 'Update the app to continue.',
  'error.INTERNAL': 'Something went wrong. Try again in a moment.',

  // The copy of spec 8.4, which states exactly what each figure represents.
  'copy.offline_save': 'Saved on this phone. It will upload when you are back online.',
  'copy.pending_work':
    'Only approved {term.activity:other:lower} count toward your {term.target:other:lower}.',
  'copy.order_request':
    'This {term.order:lower} is a request. Accepting it does not create an invoice, reduce stock or count as sales.',
  'copy.ranking':
    'Indicative ranking. People without locked {term.target:other:lower} are not ranked.',
  'copy.provisional_pay': 'Attendance-based estimate. This is not a statutory payroll document.',
  'copy.gallery_photo':
    'Chosen from the gallery. The time and place shown are when it was attached.',
  'copy.tracking':
    'Location is recorded only while you are on duty. Restarting the phone, force-stopping the app or battery savers can stop recording.',
  'copy.finance_snapshot':
    'Figures as of {date} from {source}. This is a dated snapshot, so check the date before relying on it.',
  'copy.locked_target': 'This {term.target:lower} is locked and can no longer be changed.',
  'copy.truncated_statement':
    'Showing the first {limit} entries. The closing balance includes every entry. Export is turned off so a partial statement is not shared.',

  // Signing in (spec 8.1, module M1).
  'signin.title': 'Sign in',
  'signin.intro': 'Use the mobile number your organisation has for you.',
  'signin.phone_label': 'Mobile number',
  'signin.phone_help': 'We will send a 6-digit code to this number.',
  'signin.phone_invalid': 'Enter a valid mobile number, such as 98765 43210.',
  'signin.send_code': 'Send code',
  'signin.code_label': 'Code',
  'signin.code_help': 'Enter the 6-digit code we sent to {phone}.',
  'signin.verify': 'Sign in',
  'signin.resend': 'Send a new code',
  'signin.resend_in': {
    one: 'You can ask for a new code in {count} second.',
    other: 'You can ask for a new code in {count} seconds.',
  },
  'signin.other_number': 'Use a different number',
  'signin.choose_title': 'Choose an organisation',
  'signin.choose_intro':
    'Your number belongs to more than one organisation. You can switch later from the menu.',

  // The web portal's frame (spec 8.2).
  'shell.navigation': 'Main menu',
  'shell.home': 'Home',
  'shell.account_menu': 'Your profile and settings',
  'shell.switch_organisation': 'Switch organisation',
  'shell.sign_out': 'Sign out',
  'shell.language': 'Language',
  'shell.theme': 'Theme',
  'shell.theme_light': 'Light',
  'shell.theme_dark': 'Dark',
  'shell.theme_outdoor': 'High contrast',
  'shell.skip': 'Skip to content',

  // The mobile app's frame (spec 8.1).
  'app.home': 'Home',
  'app.me': 'Me',
  'app.organisation': 'Organisation',
  'app.display': 'Display',
  'app.display_system': 'Same as phone',
  'app.display_outdoor': 'Outdoor',
  'app.display_help': 'Outdoor is high contrast, for work in bright sun.',
  'app.version': 'App version {version}',
  'app.update_title': 'Update the app',
  'app.update_body': 'This version of the app is no longer supported. Update it to keep working.',
  'app.update_action': 'Open the store',
  'home.greeting': 'Hello, {name}',
  'home.where': '{designation} at {tenant}',
  'home.empty_title': 'Your dashboard is on its way',
  'home.empty_body':
    'Sign-in, roles and settings are ready. Next come {term.activity:other:lower}, {term.journey_plan:other:lower} and {term.target:other:lower}.',
  'common.loading': 'Loading…',
  'common.offline': 'The server could not be reached. Check your connection, then try again.',
  'common.retry': 'Try again',
  'common.back': 'Back',

  // The sync banner on the mobile home screen (spec 8.1).
  'sync.waiting': {
    one: '{count} item is waiting to upload.',
    other: '{count} items are waiting to upload.',
  },
  'sync.refused': {
    one: '{count} item was refused. Open the upload queue to see why.',
    other: '{count} items were refused. Open the upload queue to see why.',
  },
  'sync.offline': {
    one: 'Offline. {count} item is saved on this phone.',
    other: 'Offline. {count} items are saved on this phone.',
  },
  'sync.view': 'View',

  // The upload queue (spec 8.1 More, 11.3).
  'uploads.title': 'Upload queue',
  'uploads.intro': 'What you save on this phone waits here until it reaches the server.',
  'uploads.empty_title': 'Everything has uploaded',
  'uploads.empty_body':
    'When there is no signal, what you save waits here and uploads by itself once the signal returns.',
  'uploads.sync_now': 'Sync now',
  'uploads.last_sync': 'Last synced {time}',
  'uploads.never_synced': 'Not synced yet',
  'uploads.offline': 'No signal. Everything uploads by itself when it returns.',
  'uploads.queued': 'Waiting',
  'uploads.parked': 'Refused',
  'uploads.saved_at': 'Saved {time}',
  'uploads.next_try': 'Next try {time}',
  'uploads.discard': 'Discard',
  'uploads.discard_confirm':
    'Discard this record? It is deleted from this phone and will never upload.',
  'uploads.discard_yes': 'Discard it',
  'uploads.discard_no': 'Keep it',
  'uploads.item': 'Record ({kind})',
  'uploads.DEPENDENCY_DISCARDED':
    "Something this record needed was discarded, so it can't upload. Discard it too.",
  'uploads.UNKNOWN_KIND': "This version of the app can't upload this record. Update the app.",
  'app.uploads': 'Upload queue',
  'app.uploads_waiting': {
    one: '{count} waiting',
    other: '{count} waiting',
  },
  'app.uploads_done': 'Everything has uploaded',
  'app.sign_out_unsent': {
    one: "{count} record hasn't uploaded. It stays on this phone and uploads when you sign in again.",
    other:
      "{count} records haven't uploaded. They stay on this phone and upload when you sign in again.",
  },
  'app.sign_out_anyway': 'Sign out anyway',
  'app.stay_signed_in': 'Stay signed in',
} as const satisfies Record<string, string | { one: string; other: string }>;

export type MessageKey = keyof typeof en;
