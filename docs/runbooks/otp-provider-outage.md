# OTP provider outage

Sign-in depends on SMS codes, sent by MSG91 (decision D67). An outage shows as people not receiving codes, and as `Sending a code failed` in the API's log.

1. **Confirm it:** MSG91's status page and dashboard; the API's log (`/kshetra-<environment>-cell1/api`) for `MSG91 answered …`; whether it is every operator or one.
2. **People already signed in carry on:** refresh tokens last 30 days, so the field keeps working; only new sign-ins and new phones wait.
3. **Wait or switch:** a short outage needs only a message to admins ([incident response](incident-response.md)). A second provider behind `OtpSender` is planned (spec 14.6); until it exists, there is nothing to switch to, and the fallback is waiting.
4. **When it recovers**, people ask for a new code; old codes expire after 5 minutes anyway.
