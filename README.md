# Abatement Link v2.1 - Supabase Live Data Build

This is the first database-backed version of Abatement Link.

## What works

- Email/password signup and login through Supabase Auth.
- Device claiming by serial number.
- Device starts as Not Verified.
- Device can be marked verified by matching validation_code through the ingest endpoint, or by the test button in the UI.
- Connected/disconnected status uses last_seen_at and the 3-hour rule.
- Device JSON ingestion through Netlify Function: `/.netlify/functions/ingest-device`.
- Raw payload + parsed readings saved to Supabase.
- Latest metric tiles update from database values.
- Datalog and alarm history are stored in Supabase.
- Supabase Realtime subscriptions refresh dashboards when device/readings/alarm rows change.
- Notification rules are saved in the database.
- Notification logs are queued by ingest when alarm/OK events occur.
- SMS is visible but intentionally disabled for future Plivo integration.
- Companies, members, and company-device sharing are included.
- Deleting a device cascades data, alarms, notification rules/logs, and company-device links.

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run:

   `database/abatement-link-supabase-schema.sql`

3. In Supabase Auth settings, enable email/password signups. Email confirmation can be enabled or disabled depending on how strict you want the test flow to be.
4. In Netlify, add environment variables:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DEVICE_INGEST_SECRET`

5. Netlify build settings:

   - Base directory: blank
   - Build command: `npm run build`
   - Publish directory: `dist`

6. Deploy.

## Device ingest

POST JSON to:

`https://YOUR-SITE.netlify.app/.netlify/functions/ingest-device`

Headers:

`content-type: application/json`
`x-ingest-secret: YOUR_DEVICE_INGEST_SECRET`

Example body:

```json
{
  "unique_id": "14374082",
  "JobNo": "41399",
  "TS": "03/24/26,03:10:00",
  "Count": "1",
  "RoomNo1": "1",
  "Event1": "PRESSURE R1S1 INTERVAL -13.860 SET MENU PASSWORD",
  "UpLim1": "-6.494 SET MENU PASSWORD",
  "LowLim1": "-23.988 SET MENU PASSWORD"
}
```

To validate a device from ingest, include:

```json
{
  "unique_id": "14374082",
  "validation_code": "123456",
  "Count": "1",
  "Event1": "PRESSURE R1S1 OK -13.860 NORMAL"
}
```

## Notes

- SMS/Plivo is not wired yet. Notification logs store `future-plivo` when SMS is eventually enabled.
- Email notification delivery is not wired yet; rules/logs are database-functional, but provider delivery should be added after the app foundation is stable.
- Push permission request exists in the UI, but true Web Push delivery needs a VAPID/server worker integration in a later version.


## v2.1 debug fix

This version disables service-worker/offline caching while the Supabase live-data build is being tested. This prevents old cached bundles from showing a blank page after deploys. It also adds a visible startup error screen so browser runtime errors are no longer silent blank pages.


## v2.7 notes

- Fixed parser bug where `R1S1` numbers could be mistaken for the reading value.
- Datalog now separates event type from alarm state.
- INTERVAL data inside limits is stored as OK, not High.
- Ingest page includes Start Live Data simulator that posts believable readings every minute while the page is open.
- Ingest endpoint accepts secret by `x-ingest-secret` header, `secret` query string, or `secret` field in JSON body.


## v2.8 alarm simulation update

- Parses real device alarm strings: `HIGH ALARM`, `LOW ALARM`, and `OK ALARM`.
- `OK ALARM` resolves active alarms after the value returns to range.
- The live-data simulator now sends mostly normal `INTERVAL` records, occasionally sends out-of-range `HIGH ALARM` or `LOW ALARM`, then sends an `OK ALARM` recovery sample.
- No Supabase SQL patch is required for this update.

## v2.11 real phone push + device search

New in v2.11:
- Real browser/phone push notifications using Web Push/VAPID.
- `/push-sw.js` service worker for alarm notifications.
- Ingest function sends phone pushes for enabled High, Low, and OK alarm notifications.
- Device page notification settings now has an Enable phone alerts button.
- Devices page includes a typeahead filter beside Your devices for company, device type, name, and serial number.

Existing Supabase projects must run:
`database/abatement-link-v2-11-real-push-patch.sql`

New Netlify env vars:
- `VITE_VAPID_PUBLIC_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT=mailto:support@abatement.ca`

To generate VAPID keys without local Node/npm after deploying this build once, open:
`https://YOUR-SITE.netlify.app/.netlify/functions/generate-vapid?secret=YOUR_DEVICE_INGEST_SECRET`

Then copy the returned values into Netlify env vars and clear cache/redeploy.
