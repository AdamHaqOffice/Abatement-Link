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

## v2.14 notes

This build uses v2.11 as the baseline and adds:

- Device detail reminders for alarm setup: users are told to set off an alarm with their desired alarm points because Abatement Link cannot know alarm points until the unit sends HIGH ALARM / LOW ALARM / OK ALARM data.
- Device detail reminder for live interval setup: if there is no current interval data, the page tells users to go to Communications > Cloud Setup > Cloud Intervals on the device.
- Pending company email access: admins can add an email before that person has an account. The pending email is shown in the company. When that email signs up, the database trigger automatically creates their company membership so they can see shared devices.
- Clear roles: Admins can add/delete users and devices. Viewers can view shared devices/data only.

Existing databases should run:

```sql
database/abatement-link-v2-14-device-setup-company-invites-patch.sql
```

## v2.15 CSV export + QA seed data

Device detail pages now include a **Download CSV** button. The export modal lets the user choose all days or a date range, and optionally thin normal datalog rows by downloading every 2nd, 5th, 10th, 50th, or 100th record. Alarm rows are always included.

For QA/demo data, run this optional SQL file in Supabase SQL Editor:

```txt
database/abatement-link-v2-15-seed-20-test-devices.sql
```

At the top of that file, change `seed_user_email` if your test account is not `abatetester1@yopmail.com`.

## v2.16 duplicate serial ownership transfer

This build adds safe handling for a serial number that is already registered:

- Add Device now checks the serial through a protected Netlify function.
- If the serial already exists, the UI warns: "This device already exists, if you verify it all previous data may be deleted and ownership will be moved to this account."
- The user can still add the device as **Not Verified**.
- After the physical device verifies that new claim with the validation code, the device page asks whether to:
  - keep previous datalog/alarm history and move it to the new account, or
  - delete previous datalog/alarm history and start fresh.
- The old registration is removed after the user makes that choice.

Existing databases must run:

```txt
database/abatement-link-v2-16-serial-takeover-patch.sql
```

This patch removes the unique serial-number constraint so a pending Not Verified claim can exist while the old registration is still active.


## v2.18 real firmware JSON ingest update

This build updates the parser and ingest simulator for the real PPM/RPM firmware JSON format:

- Interval JSON supports `Count` plus numbered fields: `RoomNo1`, `Event1`, `UpLim1`, `LowLim1`, etc.
- Alarm JSON supports the single-sensor shape: `RoomNo`, `Event`, `UpLim`, `LowLim`.
- Event parsing now supports both `R1S1` and firmware spacing like `R1 S1`.
- Timestamp parsing now supports comma-separated and space-separated device timestamps, including spaces around colons.
- Numeric parsing preserves spaced negative values like `- 0.0001inWC`.
- Ingest samples and the live simulator now use firmware-style pressure units and alarm messages.

No Supabase patch is required for v2.18.

## v2.19 Projects MVP

Adds the first Projects framework for Abatement Link, with ICRA / Healthcare Construction as the first project type.

### Deploy notes

Run this Supabase patch before using Projects:

```txt
database/abatement-link-v2-19-projects-mvp-patch.sql
```

This patch adds project tables, RLS policies, project type seed data, project asset assignments, project requirements, project events, corrective actions, and draft report records.

### What Projects do in this version

- Adds Projects navigation.
- Allows creating ICRA / Healthcare Construction projects.
- Allows assigning existing Abatement Link devices to a project with assignment timestamps.
- Allows removing a device without deleting historical project association.
- Allows starting, pausing, and completing a project.
- Allows recording project requirements with effective timestamps.
- Allows documenting project events and corrective actions.
- Shows a project dashboard using existing readings, alarms, and devices.

Projects do not duplicate raw measurement data. Existing device_readings remain the source of truth.
