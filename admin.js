// ═══════════════════════════════════════════════════════════
//  Census Survey — Admin Dashboard
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';
const ADMIN_PIN = '2027'; // Change this to your preferred PIN

let db = null;
let allSurveyors = [];
let allSurveys = [];

try {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

// ── PIN ──
function verifyPin() {
  const input = document.getElementById('pinInput').value.trim();
  const err = document.getElementById('pinErr');
  if (input === ADMIN_PIN) {
    err.classList.add('hidden');
    document.getElementById('pinScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadData();
  } else {
    err.classList.remove('hidden');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
  }
}

function lockDashboard() {
  document.getElementById('pinScreen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('pinInput').value = '';
}

// ── THEME ──
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('census-theme', next);
  document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = next === 'dark' ? '☀' : '🌙');
}

// ── TABS ──
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('section-approvals').classList.toggle('hidden', tab !== 'approvals');
  document.getElementById('section-surveys').classList.toggle('hidden', tab !== 'surveys');
  if (tab === 'surveys' && allSurveys.length === 0) loadSurveys();
}

// ── LOAD DATA ──
async function loadData() {
  await loadSurveyors();
  updateStats();
}

async function loadSurveyors() {
  const el = document.getElementById('approvals-list');
  el.innerHTML = '<div class="empty-state">⏳ Loading surveyors…</div>';

  try {
    const { data, error } = await db
      .from('surveyor_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    allSurveyors = data || [];
    renderSurveyors();
    updateStats();
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--rose-lt);">❌ ${e.message}</div>`;
  }
}

function renderSurveyors() {
  const el = document.getElementById('approvals-list');
  if (!allSurveyors.length) {
    el.innerHTML = '<div class="empty-state">📭 No surveyors registered yet.</div>';
    return;
  }

  el.innerHTML = allSurveyors.map(p => {
    const dt = new Date(p.created_at);
    const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const isApproved = p.approved;
    return `
      <div class="surveyor-card">
        <div class="surveyor-avatar">👤</div>
        <div class="surveyor-info">
          <div class="surveyor-name">${escapeHtml(p.name || 'Unknown')}</div>
          <div class="surveyor-email">${escapeHtml(p.email)}</div>
          <div class="surveyor-date">Registered: ${date}</div>
          <div class="send-email-wrap">
            <input type="checkbox" id="email-${p.id}" ${isApproved ? '' : 'checked'}>
            <label for="email-${p.id}">📧 Send approval email</label>
          </div>
        </div>
        <div class="surveyor-actions">
          ${isApproved
            ? `<button class="action-btn btn-reject" onclick="setApproval('${p.id}', false, this)">❌ Revoke</button>`
            : `<button class="action-btn btn-approve" onclick="setApproval('${p.id}', true, this)">✅ Approve</button>`
          }
          <button class="action-btn btn-reset" onclick="resetPassword('${p.id}', this)">🔑 Reset Pwd</button>
        </div>
        <div class="surveyor-status ${isApproved ? 'status-approved' : 'status-pending'}">
          ${isApproved ? '✅ Approved' : '⏳ Pending'}
        </div>
      </div>
    `;
  }).join('');
}

// ── APPROVAL ──
async function setApproval(id, approved, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';

  try {
    const { error } = await db
      .from('surveyor_profiles')
      .update({ approved })
      .eq('id', id);

    if (error) throw error;

    const p = allSurveyors.find(x => x.id === id);
    if (p) p.approved = approved;

    renderSurveyors();
    updateStats();
    showToast(approved ? '✅ Surveyor approved!' : '❌ Surveyor revoked.');
  } catch (e) {
    showToast('❌ Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = approved ? '✅ Approve' : '❌ Revoke';
  }
}

// ── RESET PASSWORD ──
async function resetPassword(id, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';

  try {
    const { error } = await db
      .from('surveyor_profiles')
      .update({ force_password_reset: true })
      .eq('id', id);

    if (error) throw error;

    showToast('🔑 Password reset triggered. User must set new password on next login.');
  } catch (e) {
    showToast('❌ Error: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = '🔑 Reset Pwd';
}

// ── SURVEYS ──
async function loadSurveys() {
  const el = document.getElementById('all-surveys-list');
  el.innerHTML = '<div class="empty-state">⏳ Loading surveys…</div>';

  try {
    const { data, error } = await db
      .from('census_surveys')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    allSurveys = data || [];
    renderSurveys();
  } catch (e) {
    el.innerHTML = `<div class="empty-state" style="color:var(--rose-lt);">❌ ${e.message}</div>`;
  }
}

function renderSurveys() {
  const el = document.getElementById('all-surveys-list');
  if (!allSurveys.length) {
    el.innerHTML = '<div class="empty-state">📭 No survey submissions yet.</div>';
    return;
  }

  let html = `<table class="records-table"><thead><tr>
    <th>#</th><th>Date</th><th>Surveyor</th><th>Line No.</th><th>Building</th><th>House</th>
    <th>Head Name</th><th>Gender</th><th>Persons</th><th>Rooms</th><th>Mobile</th>
  </tr></thead><tbody>`;

  allSurveys.forEach((r, i) => {
    const dt = new Date(r.created_at);
    const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    html += `<tr>
      <td>${i + 1}</td>
      <td><div style="font-weight:600;">${date}</div><div style="font-size:0.7rem;color:var(--t3);">${time}</div></td>
      <td>${escapeHtml(r.surveyor_email || '—')}</td>
      <td>${r.q1_line_number || '—'}</td>
      <td>${escapeHtml(r.q2_building_number || '—')}</td>
      <td>${escapeHtml(r.q3_census_house_number || '—')}</td>
      <td>${escapeHtml(r.q11_head_name || '—')}</td>
      <td>${escapeHtml(r.q12_gender || '—')}</td>
      <td>${r.q10_persons_count || '—'}</td>
      <td>${r.q15_rooms_count || '—'}</td>
      <td>${escapeHtml(r.q34_mobile_number || '—')}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

// ── STATS ──
function updateStats() {
  const total = allSurveyors.length;
  const pending = allSurveyors.filter(s => !s.approved).length;
  const approved = allSurveyors.filter(s => s.approved).length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-approved').textContent = approved;

  const badge = document.getElementById('tab-pending-badge');
  if (pending > 0) {
    badge.textContent = pending;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }

  // Also fetch survey count
  db.from('census_surveys').select('*', { count: 'exact', head: true }).then(({ count }) => {
    document.getElementById('stat-surveys').textContent = count || 0;
  });
}

// ── UTILS ──
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById('global-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
