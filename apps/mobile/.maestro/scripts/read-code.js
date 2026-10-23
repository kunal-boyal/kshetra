// The newest sign-in code sent to TO, from the local Mailpit inbox (OTP_PROVIDER=mailpit).
/* global TO, MAILPIT, http, json, output -- Maestro gives scripts these. */
const query = encodeURIComponent('to:' + TO);
const found = http.get(MAILPIT + '/api/v1/search?limit=1&query=' + query);
const messages = json(found.body).messages;
if (!messages || messages.length === 0) throw new Error('No code in Mailpit yet');
output.code = messages[0].Subject.replace('Code ', '');
