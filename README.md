# Abatement Link v1

Mobile-first PWA prototype for Abatement device cloud replacement.

## What works in v1

- Email/password sign-up flow with demo email verification code `123456`
- Mobile-first dashboard
- Add device by serial number
- Device starts as **Not Verified**
- Demo device validation button
- Device is **Connected** when latest data is within 3 hours
- Paste/ingest device JSON from the Data Ingest page
- Parses serial, job number, timestamp, room/sensor, metric, value, upper limit, lower limit, and alarm state
- Latest metric tiles for Pressure, Temp, Humidity, Particles, ACH, Velocity
- Datalog
- Alarm history
- Notification preference UI for Push, Email, SMS
- Browser push notification test if permission is granted
- Email notification entries are queued in the local notification log
- SMS is UI-only for future Plivo integration
- Companies, company invites, company device sharing
- Delete device removes device, data, alarms, notification rules, notification logs, and company links
- Local export/import/reset tools

## Important v1 limitation

This first version uses `localStorage` so the whole flow works immediately in the browser without Supabase or an API key. It is not a real shared backend yet. Data is local to the browser.

## Next backend step

Replace the local storage layer with:

- Supabase Auth for email/password + email verification
- Supabase Postgres tables for users, devices, readings, alarms, companies, notification rules
- Netlify Function or Supabase Edge Function for `/api/ingest`
- Email sending via SendGrid/Resend/SMTP
- Plivo SMS later

## Deploy

1. Upload the contents of this folder to GitHub repo root.
2. Keep `.npmrc` in the root.
3. Do not upload `package-lock.json` if it contains a private/internal registry.
4. Netlify build command: `npm run build`
5. Netlify publish directory: `dist`
