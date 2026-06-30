import { createClient } from '@supabase/supabase-js';

const metricAliases = [
  ['PRESSURE', 'pressure'], ['TEMP', 'temperature'], ['TEMPERATURE', 'temperature'], ['HUM', 'humidity'],
  ['HUMIDITY', 'humidity'], ['PART', 'particles'], ['PARTICLE', 'particles'], ['ACH', 'ach'], ['VELOCITY', 'velocity'], ['AIRFLOW', 'velocity'],
];

function firstNumber(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseDeviceTimestamp(ts) {
  if (!ts) return new Date();
  const match = String(ts).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),(\d{1,2}):(\d{2}):(\d{2})/);
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
  const match = String(eventText || '').toUpperCase().match(/R(\d+)S(\d+)/);
  return {
    room_no: match ? Number(match[1]) : Number(fallbackRoom || 1),
    sensor_no: match ? Number(match[2]) : 1,
  };
}

function alarmState(value, upperLimit, lowerLimit, eventText) {
  const upper = String(eventText || '').toUpperCase();
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
    const value = firstNumber(eventText);
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

  const configuredSecret = process.env.DEVICE_INGEST_SECRET;
  if (configuredSecret && event.headers['x-ingest-secret'] !== configuredSecret) {
    return json(401, { error: 'Invalid ingest secret.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase server env vars are missing.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }

  const parsed = parsePayload(payload);
  if (!parsed.serial) return json(400, { error: 'Payload must include unique_id, serial, or serial_number.' });
  if (!parsed.readings.length) return json(400, { error: 'Payload did not contain any Event fields to store.' });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: device, error: deviceError } = await db.from('devices').select('*').eq('serial_number', parsed.serial).maybeSingle();
  if (deviceError) return json(500, { error: deviceError.message });
  if (!device) return json(404, { error: `Serial ${parsed.serial} has not been added by a user yet.` });

  const verifiedAt = device.verified_at || (parsed.validationCode && parsed.validationCode === device.validation_code ? new Date().toISOString() : null);
  const now = new Date().toISOString();
  const latestMetrics = { ...(device.latest_metrics || {}) };
  parsed.readings.forEach((reading) => {
    latestMetrics[reading.metric] = {
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
  const { data: rules } = await db.from('notification_rules').select('*').eq('device_id', deviceId);
  const logs = [];
  for (const rule of rules || []) {
    const extraEmails = Array.isArray(rule.extra_emails) ? rule.extra_emails : [];
    const stateKey = state === 'high' ? 'high' : state === 'low' ? 'low' : 'ok';
    if (rule[`push_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: rule.user_id, channel: 'push', alarm_state: state, recipients: [], status: 'queued' });
    if (rule[`email_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: rule.user_id, channel: 'email', alarm_state: state, recipients: extraEmails, status: 'queued' });
    if (rule[`sms_${stateKey}`]) logs.push({ device_id: deviceId, alarm_id: alarm.id, user_id: rule.user_id, channel: 'sms', alarm_state: state, recipients: [], status: 'future-plivo' });
  }
  if (logs.length) await db.from('notification_logs').insert(logs);
}
