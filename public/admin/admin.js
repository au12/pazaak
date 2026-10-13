// The admin page: rooms, who is in them, and the buttons to keep or close them.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const until = (t) => {
  if (t == null) return 'kept for good';
  const s = Math.round((t - Date.now()) / 1000);
  if (s < 0) return 'due now (once empty)';
  if (s < 3600) return `expires in ${Math.round(s / 60)}m`;
  if (s < 86400) return `expires in ${Math.round(s / 3600)}h`;
  return `expires in ${Math.round(s / 86400)}d`;
};
const dur = (s) => (s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`);

async function api(path, opts = {}) {
  const res = await fetch(`admin/api/${path}`, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    show(false);
    throw new Error('signed out');
  }
  if (!res.ok) throw new Error(body.error ?? 'Request failed');
  return body;
}

function show(signedIn) {
  $('signin').hidden = signedIn;
  $('dash').hidden = !signedIn;
  $('signout').hidden = !signedIn;
}

function render(data) {
  const s = data.server;
  $('stats').innerHTML = [
    [s.rooms, 'rooms'],
    [s.online, 'people online'],
    [s.sockets, 'connections'],
    [dur(s.uptime), 'uptime'],
    [s.saveError ? 'error' : ago(s.savedAt), s.saveError ? esc(s.saveError) : 'last saved'],
  ]
    .map(([b, l]) => `<div><b>${esc(b)}</b><span>${l}</span></div>`)
    .join('');
  $('rooms').innerHTML = data.rooms.length
    ? data.rooms
        .map((r) => {
          const seats = r.seats.map((x) => (x ? `${esc(x.name)}${x.bot ? ' (computer)' : x.online ? ' <span class="on">●</span>' : ' <span class="off">●</span>'}` : '<span class="empty">empty</span>')).join(' vs ');
          const m = r.match;
          const match = m ? (m.live ? `Set ${m.setNo || '–'}: ${m.score.map((x) => `${esc(x.name)} ${x.wins}${x.total != null ? ` (on ${x.total})` : ''}`).join(', ')}, ${m.phase}` : `Last match won by ${esc(m.winner ?? '—')}`) : 'No match yet';
          const people = r.people.map((p) => `${esc(p.name)}${p.online ? ' <span class="on">●</span>' : ''}`).join(', ') || '<span class="empty">nobody</span>';
          const record = r.record.length ? `Record: ${r.record.map((x) => `${esc(x.name)} ${x.wins}`).join(', ')}` : '';
          return `<div class="room">
            <h3><a href="r/${encodeURIComponent(r.code)}" target="_blank">${esc(r.code)}</a></h3>
            <div class="actions">
              <button class="keep" data-act="${r.keep ? 'release' : 'keep'}" data-code="${esc(r.code)}">${r.keep ? 'Let it expire' : 'Keep for good'}</button>
              <button class="danger" data-act="delete" data-code="${esc(r.code)}">Delete</button>
            </div>
            <div class="meta">Seats: ${seats}. ${match}.</div>
            <div class="meta">People: ${people}. Host: ${esc(r.host)}. ${record}</div>
            <div class="meta">Created ${ago(r.createdAt)}, last active ${ago(r.lastActive)}, ${until(r.expiresAt)}.</div>
          </div>`;
        })
        .join('')
    : '<p class="empty">No rooms right now.</p>';
  $('activity').innerHTML = data.activity.map((a) => `<li>${new Date(a.at).toLocaleTimeString()}: ${esc(a.kind)} ${esc(a.code ?? '')}${a.why ? ` (${esc(a.why)})` : ''}</li>`).join('') || '<li>Nothing yet.</li>';
}

async function refresh() {
  try {
    render(await api('rooms'));
    show(true);
  } catch {}
}

$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('err').textContent = '';
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = '';
    refresh();
  } catch (err) {
    $('err').textContent = err.message;
  }
});
$('signout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  show(false);
});
$('rooms').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'delete' && !confirm(`Delete ${b.dataset.code}? Anyone in it is sent back to the start.`)) return;
  try {
    await api(`rooms/${encodeURIComponent(b.dataset.code)}/${b.dataset.act}`, { method: 'POST' });
  } catch (err) {
    alert(err.message);
  }
  refresh();
});

show(false);
refresh();
setInterval(refresh, 5000);
