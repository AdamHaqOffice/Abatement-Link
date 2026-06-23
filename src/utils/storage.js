const KEY = 'abatement-link-v1-db';

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function seedDb() {
  return {
    currentUserId: null,
    users: [],
    devices: [],
    readings: [],
    alarms: [],
    notificationRules: [],
    notificationLog: [],
    companies: [],
    companyMembers: [],
    companyDevices: [],
    invites: [],
  };
}

export function loadDb() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedDb();
    return { ...seedDb(), ...JSON.parse(raw) };
  } catch {
    return seedDb();
  }
}

export function saveDb(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
  window.dispatchEvent(new Event('abatement-link-db-change'));
}

export function resetDb() {
  const db = seedDb();
  saveDb(db);
  return db;
}

export function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}
