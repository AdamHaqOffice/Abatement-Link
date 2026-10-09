const metricAliases = [
  ['PRESSURE', 'pressure'],
  ['TEMP', 'temperature'],
  ['TEMPERATURE', 'temperature'],
  ['HUM', 'humidity'],
  ['HUMIDITY', 'humidity'],
  ['PART', 'particles'],
  ['PARTICLE', 'particles'],
  ['ACH', 'ach'],
  ['VELOCITY', 'velocity'],
  ['AIRFLOW', 'velocity'],
];

function clampRoomSensor(value) {
  const number = Number(value || 1);
  if (!Number.isFinite(number)) return 1;
  return Math.min(2, Math.max(1, number));
}

export function parseDeviceTimestamp(ts) {
  if (!ts) return new Date();
  const text = String(ts).replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[,\s]+(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})/);
  if (!match) return new Date();
  const [, mm, dd, yy, hh, min, ss] = match;
  const year = Number(yy) < 100 ? 2000 + Number(yy) : Number(yy);
  return new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
}

export function normalizeNumberText(value) {
  // Firmware strings can contain a spaced negative sign, e.g. "INTERVAL - 0.0001inWC".
  // Normalize that before extracting numeric values so the sign is preserved.
  return String(value ?? '').replace(/-\s+(?=\d)/g, '-');
}

export function firstNumber(value) {
  const match = normalizeNumberText(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function lastNumber(value) {
  const matches = normalizeNumberText(value).match(/-?\d+(?:\.\d+)?/g);
  return matches?.length ? Number(matches[matches.length - 1]) : null;
}

function getMetric(eventText) {
  const upper = String(eventText || '').toUpperCase();
  const match = metricAliases.find(([needle]) => upper.includes(needle));
  return match ? match[1] : 'unknown';
}

function getRoomSensor(eventText, fallbackRoom) {
  const upper = String(eventText || '').toUpperCase();
  const match = upper.match(/R\s*(\d+)\s*S\s*(\d+)/);
  return {
    room: clampRoomSensor(match ? match[1] : fallbackRoom),
    sensor: clampRoomSensor(match ? match[2] : 1),
  };
}

function alarmState(value, upLimit, lowLimit, eventText) {
  const upper = String(eventText || '').toUpperCase();

  // Real device alarm strings. These should override any numeric guesswork.
  if (upper.includes('OK ALARM') || upper.includes('RETURN TO OK')) return 'ok';
  if (upper.includes('HIGH ALARM')) return 'high';
  if (upper.includes('LOW ALARM')) return 'low';

  if (upper.includes('INTERVAL')) {
    if (value !== null && upLimit !== null && value > upLimit) return 'high';
    if (value !== null && lowLimit !== null && value < lowLimit) return 'low';
    return 'ok';
  }

  if (upper.includes('HIGH')) return 'high';
  if (upper.includes('LOW')) return 'low';
  if (upper.includes('OK') || upper.includes('NORMAL')) return 'ok';
  if (value !== null && upLimit !== null && value > upLimit) return 'high';
  if (value !== null && lowLimit !== null && value < lowLimit) return 'low';
  return 'ok';
}

export function parsePayload(payload) {
  const serial = String(payload.unique_id || payload.serial || payload.serial_number || '').trim();
  const jobNo = String(payload.JobNo || payload.job_no || payload.jobNumber || '').trim();
  const timestamp = parseDeviceTimestamp(payload.TS || payload.timestamp);
  const validationCode = String(payload.validation_code || payload.ValidationCode || payload.code || '').trim();
  const count = Math.max(1, Number(payload.Count || 1));
  const readings = [];

  for (let i = 1; i <= count; i += 1) {
    const eventText = payload[`Event${i}`] || payload.Event || '';
    if (!eventText) continue;
    const value = lastNumber(eventText);
    const upperLimit = firstNumber(payload[`UpLim${i}`] || payload.UpLim);
    const lowerLimit = firstNumber(payload[`LowLim${i}`] || payload.LowLim);
    const { room, sensor } = getRoomSensor(eventText, payload[`RoomNo${i}`] || payload.RoomNo);
    const metric = getMetric(eventText);
    readings.push({
      serial,
      jobNo,
      timestamp: timestamp.toISOString(),
      room,
      sensor,
      metric,
      value,
      upperLimit,
      lowerLimit,
      eventText: String(eventText),
      alarmState: alarmState(value, upperLimit, lowerLimit, eventText),
      raw: payload,
    });
  }

  return { serial, jobNo, timestamp: timestamp.toISOString(), validationCode, readings };
}

export function connectionStatus(device) {
  if (!device?.verified_at) return 'not_verified';
  if (!device?.last_seen_at) return 'disconnected';
  const hours = (Date.now() - new Date(device.last_seen_at).getTime()) / 36e5;
  return hours <= 3 ? 'connected' : 'disconnected';
}

export function metricLabel(metric) {
  const value = String(metric || 'unknown');
  const isSecondSensor = value.endsWith('2');
  const base = isSecondSensor ? value.slice(0, -1) : value;
  const label = {
    pressure: 'Pressure',
    temperature: 'Temp',
    humidity: 'Humidity',
    particles: 'Particles',
    ach: 'ACH',
    velocity: 'Velocity',
    unknown: 'Unknown',
  }[base] || base;
  return `${label}${isSecondSensor ? '2' : ''}`;
}

export function metricIcon(metric) {
  const value = String(metric || 'unknown');
  const base = value.endsWith('2') ? value.slice(0, -1) : value;
  return {
    pressure: '↕',
    temperature: '℃',
    humidity: '%',
    particles: '•',
    ach: '⟳',
    velocity: '➜',
    unknown: '?',
  }[base] || '•';
}
