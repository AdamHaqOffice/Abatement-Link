import { createClient } from '@supabase/supabase-js';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeSerial(value) {
  return String(value || '').trim();
}

async function getAuthedUser(db, event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Missing signed-in user token.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new Error('Could not verify signed-in user.');
  return data.user;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase server env vars are missing.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON.' }); }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let user;
  try { user = await getAuthedUser(db, event); } catch (err) { return json(401, { error: err.message }); }

  if (body.action === 'create-device') {
    const serial = normalizeSerial(body.serial);
    const model = String(body.model || 'PPM4').trim() || 'PPM4';
    const nickname = String(body.nickname || '').trim() || `${model} ${serial}`;
    if (!serial) return json(400, { error: 'Serial number is required.' });

    const { data: existing, error: existingError } = await db.from('devices')
      .select('id, owner_id, verified_at, nickname, model, created_at')
      .eq('serial_number', serial)
      .order('created_at', { ascending: false });
    if (existingError) return json(500, { error: existingError.message });

    const duplicates = existing || [];
    if (duplicates.length && !body.confirmDuplicate) {
      return json(200, {
        requiresConfirmation: true,
        serial,
        duplicateCount: duplicates.length,
        message: 'This device already exists, if you verify it all previous data may be deleted and ownership will be moved to this account.',
      });
    }

    const validationCode = randomCode();
    const { data: device, error: insertError } = await db.from('devices').insert({
      owner_id: user.id,
      serial_number: serial,
      nickname,
      model,
      validation_code: validationCode,
      pending_takeover: duplicates.length > 0,
      verified_at: null,
    }).select('*').single();

    if (insertError) return json(500, { error: insertError.message });

    return json(200, {
      ok: true,
      device,
      pendingTakeover: duplicates.length > 0,
      message: duplicates.length
        ? 'Device added as Not Verified. After verification, choose whether to keep or delete previous data.'
        : 'Device added as Not Verified.',
    });
  }

  if (body.action === 'finalize-takeover') {
    const deviceId = body.deviceId;
    const deletePreviousData = Boolean(body.deletePreviousData);
    if (!deviceId) return json(400, { error: 'deviceId is required.' });

    const { data: device, error: deviceError } = await db.from('devices').select('*').eq('id', deviceId).maybeSingle();
    if (deviceError) return json(500, { error: deviceError.message });
    if (!device) return json(404, { error: 'Device not found.' });
    if (device.owner_id !== user.id) return json(403, { error: 'Only the account that added this device can finish ownership transfer.' });
    if (!device.verified_at) return json(400, { error: 'Verify this device first, then choose whether to keep or delete previous data.' });

    const { data: previous, error: previousError } = await db.from('devices')
      .select('*')
      .eq('serial_number', device.serial_number)
      .neq('id', device.id)
      .order('updated_at', { ascending: false });
    if (previousError) return json(500, { error: previousError.message });

    const previousIds = (previous || []).map((item) => item.id);
    const now = new Date().toISOString();
    let movedReadings = 0;
    let movedAlarms = 0;

    if (previousIds.length) {
      if (!deletePreviousData) {
        const { data: movedReadingRows, error: readingError } = await db.from('device_readings')
          .update({ device_id: device.id })
          .in('device_id', previousIds)
          .select('id');
        if (readingError) return json(500, { error: readingError.message });
        movedReadings = movedReadingRows?.length || 0;

        const { data: movedAlarmRows, error: alarmError } = await db.from('alarm_events')
          .update({ device_id: device.id })
          .in('device_id', previousIds)
          .select('id');
        if (alarmError) return json(500, { error: alarmError.message });
        movedAlarms = movedAlarmRows?.length || 0;
      }

      const { error: deleteError } = await db.from('devices').delete().in('id', previousIds);
      if (deleteError) return json(500, { error: deleteError.message });
    }

    const latestSource = (previous || []).find((item) => item.latest_metrics && Object.keys(item.latest_metrics || {}).length) || null;
    const targetHasMetrics = device.latest_metrics && Object.keys(device.latest_metrics || {}).length;
    const updatePayload = {
      owner_id: user.id,
      pending_takeover: false,
      takeover_finalized_at: now,
      updated_at: now,
    };
    if (!targetHasMetrics && latestSource?.latest_metrics) updatePayload.latest_metrics = latestSource.latest_metrics;
    if (!device.last_seen_at && latestSource?.last_seen_at) updatePayload.last_seen_at = latestSource.last_seen_at;
    if (!device.last_job_no && latestSource?.last_job_no) updatePayload.last_job_no = latestSource.last_job_no;

    const { error: updateError } = await db.from('devices').update(updatePayload).eq('id', device.id);
    if (updateError) return json(500, { error: updateError.message });

    return json(200, {
      ok: true,
      serial: device.serial_number,
      deletedPreviousData: deletePreviousData,
      previousRegistrationsRemoved: previousIds.length,
      movedReadings,
      movedAlarms,
      message: deletePreviousData
        ? 'Ownership moved to this account and previous data was deleted.'
        : `Ownership moved to this account. Kept ${movedReadings} previous readings and ${movedAlarms} alarm records.`,
    });
  }

  return json(400, { error: 'Unknown action.' });
};
