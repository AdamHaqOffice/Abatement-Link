import { useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import { uid, nowIso, cleanEmail } from '../utils/storage.js';

export default function CompaniesPage({ db, user, update, actions }) {
  const [companyName, setCompanyName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const companies = db.companies.filter((c) => db.companyMembers.some((m) => m.companyId === c.id && m.userId === user.id && m.acceptedAt));
  const ownedDevices = db.devices.filter((d) => d.ownerId === user.id);
  const pendingInvites = db.invites.filter((i) => i.email === user.email && !i.acceptedAt);

  function createCompany(e) {
    e.preventDefault();
    if (!companyName.trim()) return;
    update((next) => {
      const companyId = uid('co');
      next.companies.push({ id: companyId, name: companyName.trim(), ownerId: user.id, createdAt: nowIso() });
      next.companyMembers.push({ id: uid('mem'), companyId, userId: user.id, role: 'owner', acceptedAt: nowIso(), createdAt: nowIso() });
    });
    setCompanyName('');
  }

  function inviteUser(companyId) {
    const email = cleanEmail(inviteEmail);
    if (!email) return;
    update((next) => {
      next.invites.push({ id: uid('inv'), companyId, email, invitedBy: user.id, role: 'viewer', acceptedAt: null, createdAt: nowIso() });
    });
    setInviteEmail('');
  }

  function acceptInvite(inviteId) {
    update((next) => {
      const invite = next.invites.find((i) => i.id === inviteId);
      invite.acceptedAt = nowIso();
      next.companyMembers.push({ id: uid('mem'), companyId: invite.companyId, userId: user.id, role: invite.role, acceptedAt: nowIso(), createdAt: nowIso() });
    });
  }

  function addDeviceToCompany(e) {
    e.preventDefault();
    if (!selectedCompany || !selectedDevice) return;
    update((next) => {
      if (!next.companyDevices.some((cd) => cd.companyId === selectedCompany && cd.deviceId === selectedDevice)) {
        next.companyDevices.push({ id: uid('cd'), companyId: selectedCompany, deviceId: selectedDevice, createdAt: nowIso() });
      }
    });
  }

  return (
    <AppShell user={user} actions={actions} title="Companies">
      {pendingInvites.length > 0 && <section className="panel"><h2>Pending invites</h2>{pendingInvites.map((invite) => <div className="invite-row" key={invite.id}><span>{db.companies.find((c) => c.id === invite.companyId)?.name}</span><button className="primary-button" onClick={() => acceptInvite(invite.id)}>Accept</button></div>)}</section>}

      <section className="two-col">
        <div className="panel">
          <h1>Create company</h1>
          <form className="form-stack" onSubmit={createCompany}><label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Contractor / branch name" /></label><button className="primary-button">Create company</button></form>
        </div>
        <div className="panel">
          <h2>Add device to company</h2>
          <form className="form-stack" onSubmit={addDeviceToCompany}>
            <label>Company<select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)}><option value="">Choose company</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Owned device<select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}><option value="">Choose device</option>{ownedDevices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.serial}</option>)}</select></label>
            <button className="primary-button">Add device</button>
          </form>
        </div>
      </section>

      <section className="company-list">
        {companies.map((company) => {
          const members = db.companyMembers.filter((m) => m.companyId === company.id && m.acceptedAt);
          const devices = db.companyDevices.filter((cd) => cd.companyId === company.id).map((cd) => db.devices.find((d) => d.id === cd.deviceId)).filter(Boolean);
          return <div className="panel company-card" key={company.id}><div className="section-head"><div><h2>{company.name}</h2><p>{members.length} member(s) · {devices.length} device(s)</p></div></div><div className="recipient-box"><label>Invite user by email<input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" /></label><button className="secondary-button" onClick={() => inviteUser(company.id)}>Send request</button></div><div className="chip-row">{devices.map((d) => <span key={d.id}>{d.name}</span>)}</div></div>;
        })}
        {!companies.length && <div className="empty-state"><h3>No companies yet</h3><p>Create one above, then add devices and invite users.</p></div>}
      </section>
    </AppShell>
  );
}
