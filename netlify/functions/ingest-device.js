import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const metricAliases = [
  ['PRESSURE', 'pressure'], ['TEMP', 'temperature'], ['TEMPERATURE', 'temperature'], ['HUM', 'humidity'],
  ['HUMIDITY', 'humidity'], ['PART', 'particles'], ['PARTICLE', 'particles'], ['ACH', 'ach'], ['VELOCITY', 'velocity'], ['AIRFLOW', 'velocity'],
];

function clampRoomSensor(value) {
  const number = Number(value || 1);
  if (!Number.isFinite(number)) return 1;
  return Math.min(2, Math.max(1, number));
}

function normalizeNumberText(value) {
  // Firmware strings can contain a spaced negative sign, e.g. "INTERVAL - 0.0001inWC".
  // Normalize that before extracting numeric values so the sign is preserved.
  return String(value ?? '').replace(/-\s+(?=\d)/g, '-');
}

function firstNumber(value) {
  const match = normalizeNumberText(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function lastNumber(value) {
  const matches = normalizeNumberText(value).match(/-?\d+(?:\.\d+)?/g);
  return matches?.length ? Number(matches[matches.length - 1]) : null;
}

function parseDeviceTimestamp(ts) {
  if (!ts) return new Date();
  const text = String(ts).replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[,\s]+(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!match) return new Date();
  const [, mm, dd, yy, hh, min, ss] = match;
  const year = Number(yy) < 100 ? 2000 + Number(yy) : Number(yy);
  return new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
}

function metricFromEvent(eventText) {
  const upper = String(eventText || '').toUpperCase();
  const found = metricAliases.find(([needle]) => upper.includes(needle));
  return found ? found[1] : 'unknown';
}

function roomSensor(eventText, fallbackRoom) {
  const match = String(eventText || '').toUpperCase().match(/R\s*(\d+)\s*S\s*(\d+)/);
  return {
    room_no: clampRoomSensor(match ? match[1] : fallbackRoom),
    sensor_no: clampRoomSensor(match ? match[2] : 1),
  };
}

function alarmState(value, upperLimit, lowerLimit, eventText) {
  const upper = String(eventText || '').toUpperCase();

  // Real device alarm strings. These should override any numeric guesswork.
  if (upper.includes('OK ALARM') || upper.includes('RETURN TO OK')) return 'ok';
  if (upper.includes('HIGH ALARM')) return 'high';
  if (upper.includes('LOW ALARM')) return 'low';

  if (upper.includes('INTERVAL')) {
    if (value !== null && upperLimit !== null && value > upperLimit) return 'high';
    if (value !== null && lowerLimit !== null && value < lowerLimit) return 'low';
    return 'ok';
  }

  if (upper.includes('HIGH')) return 'high';
  if (upper.includes('LOW')) return 'low';
  if (upper.includes('OK') || upper.includes('NORMAL')) return 'ok';
  if (value !== null && upperLimit !== null && value > upperLimit) return 'high';
  if (value !== null && lowerLimit !== null && value < lowerLimit) return 'low';
  return 'ok';
}

function parsePayload(payload) {
  const serial = String(payload.unique_id || payload.serial || payload.serial_number || '').trim();
  const jobNo = String(payload.JobNo || payload.job_no || payload.jobNumber || '').trim();
  const deviceTs = parseDeviceTimestamp(payload.TS || payload.timestamp).toISOString();
  const validationCode = String(payload.validation_code || payload.ValidationCode || payload.code || '').trim();
  const count = Math.max(1, Number(payload.Count || 1));
  const readings = [];

  for (let i = 1; i <= count; i += 1) {
    const eventText = payload[`Event${i}`] || payload.Event || '';
    if (!eventText) continue;
    const value = lastNumber(eventText);
    const upperLimit = firstNumber(payload[`UpLim${i}`] || payload.UpLim);
    const lowerLimit = firstNumber(payload[`LowLim${i}`] || payload.LowLim);
    const metric = metricFromEvent(eventText);
    const rooms = roomSensor(eventText, payload[`RoomNo${i}`] || payload.RoomNo);
    readings.push({
      job_no: jobNo,
      device_ts: deviceTs,
      metric,
      value,
      upper_limit: upperLimit,
      lower_limit: lowerLimit,
      event_text: String(eventText),
      alarm_state: alarmState(value, upperLimit, lowerLimit, eventText),
      raw_payload: payload,
      ...rooms,
    });
  }

  return { serial, jobNo, deviceTs, validationCode, readings };
}


function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@abatement.ca';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function notificationTitle(state) {
  if (state === 'high') return 'Abatement Link: HIGH alarm';
  if (state === 'low') return 'Abatement Link: LOW alarm';
  return 'Abatement Link: returned to OK';
}

function notificationBody(device, alarm, state) {
  const label = device?.nickname || device?.serial_number || 'Device';
  const metric = String(alarm?.metric || 'reading').replace(/_/g, ' ');
  const room = alarm?.room_no ? `Room ${alarm.room_no}` : 'Room';
  const sensor = alarm?.sensor_no ? `S${alarm.sensor_no}` : '';
  const value = alarm?.value ?? '—';
  return `${label} · ${room}${sensor ? ` ${sensor}` : ''} · ${metric} ${value}`;
}

async function sendPhonePushes(db, log, device, alarm, state, vapidReady) {
  if (!vapidReady) {
    await db.from('notification_logs').update({ status: 'no-vapid-keys' }).eq('id', log.id);
    return;
  }

  const { data: subscriptions, error } = await db.from('push_subscriptions')
    .select('*')
    .eq('user_id', log.user_id)
    .eq('enabled', true);

  if (error) {
    await db.from('notification_logs').update({ status: 'push-subscription-error', provider_response: { error: error.message } }).eq('id', log.id);
    return;
  }

  if (!subscriptions?.length) {
    await db.from('notification_logs').update({ status: 'no-phone-subscription' }).eq('id', log.id);
    return;
  }

  const payload = JSON.stringify({
    title: notificationTitle(state),
    body: notificationBody(device, alarm, state),
    icon: '/icon-192.png',
    badge: '/favicon.png',
    tag: `alarm-${device.id}-${alarm.metric || 'metric'}-r${alarm.room_no || 0}-s${alarm.sensor_no || 0}`,
    requireInteraction: state === 'high' || state === 'low',
    data: { url: `/devices/${device.id}`, deviceId: device.id, alarmId: alarm.id, state },
  });

  const results = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, payload);
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (err) {
      const statusCode = err.statusCode || err.status;
      results.push({ endpoint: sub.endpoint, ok: false, statusCode, message: err.message });
      if (statusCode === 404 || statusCode === 410) {
        await db.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('id', sub.id);
      }
    }
  }

  const sent = results.filter((item) => item.ok).length;
  await db.from('notification_logs').update({
    status: sent ? 'sent-phone-push' : 'push-send-failed',
    recipients: subscriptions.map((sub) => sub.endpoint),
    provider_response: { sent, attempted: results.length, results },
  }).eq('id', log.id);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }

  const configuredSecret = process.env.DEVICE_INGEST_SECRET;
  const providedSecret = event.headers['x-ingest-secret'] || event.queryStringParameters?.secret || payload.secret;
  if (configuredSecret && providedSecret !== configuredSecret) {
    return json(401, { error: 'Invalid ingest secret.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase server env vars are missing.' });

  const parsed = parsePayload(payload);
  if (!parsed.serial) return json(400, { error: 'Payload must include unique_id, serial, or serial_number.' });
  if (!parsed.readings.length) return json(400, { error: 'Payload did not contain any Event fields to store.' });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: matchingDevices, error: deviceError } = await db.from('devices')
    .select('*')
    .eq('serial_number', parsed.serial)
    .order('created_at', { ascending: false });
  if (deviceError) return json(500, { error: deviceError.message });
  if (!matchingDevices?.length) return json(404, { error: `Serial ${parsed.serial} has not been added by a user yet.` });

  // A serial can have an older verified registration plus a newer Not Verified ownership claim.
  // If the payload includes a validation code, prioritize the matching claim. Otherwise,
  // send live data to the finalized/current verified registration until ownership is finalized.
  let device = null;
  if (parsed.validationCode) {
    device = matchingDevices.find((item) => String(item.validation_code || '') === parsed.validationCode) || null;
  }
  if (!device) {
    device = matchingDevices.find((item) => item.verified_at && !item.pending_takeover) ||
      matchingDevices.find((item) => item.verified_at) ||
      matchingDevices[0];
  }

  const verifiedAt = device.verified_at || (parsed.validationCode && parsed.validationCode === device.validation_code ? new Date().toISOString() : null);
  const now = new Date().toISOString();
  const latestMetrics = { ...(device.latest_metrics || {}) };
  parsed.readings.forEach((reading) => {
    const metricKey = Number(reading.sensor_no) === 2 ? `${reading.metric}2` : reading.metric;
    latestMetrics[metricKey] = {
      value: reading.value,
      timestamp: reading.device_ts,
      room: reading.room_no,
      sensor: reading.sensor_no,
      alarmState: reading.alarm_state,
    };
  });

  const { error: updateError } = await db.from('devices').update({
    verified_at: verifiedAt,
    last_seen_at: now,
    last_job_no: parsed.jobNo || device.last_job_no,
    latest_metrics: latestMetrics,
    updated_at: now,
  }).eq('id', device.id);
  if (updateError) return json(500, { error: updateError.message });

  const rows = parsed.readings.map((reading) => ({ ...reading, device_id: device.id, serial_number: parsed.serial, received_at: now }));
  const { data: inserted, error: insertError } = await db.from('device_readings').insert(rows).select('*');
  if (insertError) return json(500, { error: insertError.message });

  for (const reading of inserted) {
    const { data: active } = await db.from('alarm_events')
      .select('*')
      .eq('device_id', device.id)
      .eq('metric', reading.metric)
      .eq('room_no', reading.room_no)
      .eq('sensor_no', reading.sensor_no)
      .is('resolved_at', null)
      .maybeSingle();

    if (reading.alarm_state === 'high' || reading.alarm_state === 'low') {
      if (!active || active.alarm_state !== reading.alarm_state) {
        if (active) await db.from('alarm_events').update({ resolved_at: reading.device_ts }).eq('id', active.id);
        const limitValue = reading.alarm_state === 'high' ? reading.upper_limit : reading.lower_limit;
        const { data: alarm } = await db.from('alarm_events').insert({
          device_id: device.id,
          reading_id: reading.id,
          alarm_state: reading.alarm_state,
          metric: reading.metric,
          room_no: reading.room_no,
          sensor_no: reading.sensor_no,
          value: reading.value,
          limit_value: limitValue,
          event_text: reading.event_text,
          started_at: reading.device_ts,
        }).select('*').single();

        await queueNotifications(db, device.id, alarm, reading.alarm_state);
      }
    } else if (reading.alarm_state === 'ok' && active) {
      await db.from('alarm_events').update({ resolved_at: reading.device_ts }).eq('id', active.id);
      await queueNotifications(db, device.id, active, 'ok');
    }
  }

  return json(200, { ok: true, serial: parsed.serial, deviceId: device.id, deviceStatus: verifiedAt ? 'verified' : 'not_verified', readingCount: inserted.length });
};

async function queueNotifications(db, deviceId, alarm, state) {
  const stateKey = state === 'high' ? 'high' : state === 'low' ? 'low' : 'ok';

  // Alarm-bell / push notifications are default-on for:
  // 1) the user who owns/added the device
  // 2) every accepted user in a company that contains this device
  // A notification_rules row overrides those defaults for that specific user.
  const { data: device } = await db.from('devices').select('id, owner_id, nickname, serial_number, model').eq('id', deviceId).maybeSingle();
  const stakeholderIds = new Set();
  if (device?.owner_id) stakeholderIds.add(device.owner_id);

  const { data: companyLinks } = await db.from('company_devices').select('company_id').eq('device_id', deviceId);
  const companyIds = [...new Set((companyLinks || []).map((link) => link.company_id).filter(Boolean))];
  if (companyIds.length) {
    const { data: members } = await db.from('company_members')
      .select('user_id')
      .in('company_id', companyIds)
      .not('accepted_at', 'is', null);
    for (const member of members || []) {
      if (member.user_id) stakeholderIds.add(member.user_id);
    }
  }

  // Include anyone who already created a rule for the device, even if company sharing changes later.
  const { data: rules } = await db.from('notification_rules').select('*').eq('device_id', deviceId);
  for (const rule of rules || []) {
    if (rule.user_id) stakeholderIds.add(rule.user_id);
  }

  const rulesByUser = new Map((rules || []).map((rule) => [rule.user_id, rule]));
  const logs = [];

  for (const userId of stakeholderIds) {
    const savedRule = rulesByUser.get(userId);
    const rule = savedRule || {
      user_id: userId,
      push_high: true,
      push_low: true,
      push_ok: true,
      email_high: false,
      email_low: false,
      email_ok: false,
      sms_high: false,
      sms_low: false,
      sms_ok: false,
      extra_emails: [],
    };
    const extraEmails = Array.isArray(rule.extra_emails) ? rule.extra_emails : [];

    if (rule[`push_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: userId, channel: 'push', alarm_state: state, recipients: [], status: savedRule ? 'queued' : 'default-on' });
    if (rule[`email_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: userId, channel: 'email', alarm_state: state, recipients: extraEmails, status: 'queued' });
    if (rule[`sms_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: userId, channel: 'sms', alarm_state: state, recipients: [], status: 'future-plivo' });
  }

  if (!logs.length) return;

  const { data: insertedLogs } = await db.from('notification_logs').insert(logs).select('*');
  const vapidReady = configureWebPush();

  for (const log of insertedLogs || []) {
    if (log.channel === 'push') {
      await sendPhonePushes(db, log, device, alarm, state, vapidReady);
    }
  }
}
