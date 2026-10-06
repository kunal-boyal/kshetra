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

  // The sync banner on the mobile home screen (spec 8.1).
  'sync.waiting': {
    one: '{count} item is waiting to upload.',
    other: '{count} items are waiting to upload.',
  },
  'sync.refused': {
    one: '{count} item was refused. Open the upload queue to see why.',
    other: '{count} items were refused. Open the upload queue to see why.',
  },
} as const satisfies Record<string, string | { one: string; other: string }>;

export type MessageKey = keyof typeof en;
