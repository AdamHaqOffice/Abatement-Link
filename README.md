# Abatement Link v2 - Supabase Live Data Build

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
