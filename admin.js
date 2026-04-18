// ═══════════════════════════════════════════════════════════
//  Census Survey — Admin Dashboard
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';
const ADMIN_PIN = '2027';

// ── EMAILJS CONFIG ──
const EMAILJS_PUBLIC_KEY = 'U9zPnVXLtEzAkZ54k';
const EMAILJS_SERVICE_ID = 'service_jnvTarikhet';
const EMAILJS_TEMPLATE_ID = 'template_m072fcb';

let emailjsReady = false;
let db = null;
let allSurveyors = [];
let allSurveys = [];

try {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

function initEmailJS() {
  if (typeof emailjs !== 'undefined') {
    try {
      emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      emailjsReady = true;
      console.log('[EmailJS] Initialized successfully');
    } catch (e) {
      console.error('[EmailJS] Init failed:', e);
    }
  } else {
    setTimeout(initEmailJS, 1000);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEmailJS);
} else {
  initEmailJS();
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
    const { data, error } = await db.from('surveyor_profiles').select('*').order('created_at', { ascending: false });
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
            <input type="checkbox" id="email-chk-${p.id}" ${isApproved ? '' : 'checked'}>
            <label for="email-chk-${p.id}">📧 Send approval email</label>
          </div>
        </div>
        <div class="surveyor-actions">
          ${isApproved
            ? `<button class="action-btn btn-reject" onclick="setApproval('${p.id}', false, this, false)">❌ Revoke</button>`
            : `<button class="action-btn btn-approve" onclick="setApproval('${p.id}', true, this, document.getElementById('email-chk-${p.id}').checked)">✅ Approve</button>`
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
async function setApproval(id, approved, btn, sendEmail = true) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    const { error } = await db.from('surveyor_profiles').update({ approved }).eq('id', id);
    if (error) throw error;
    const p = allSurveyors.find(x => x.id === id);
    if (p) p.approved = approved;

    if (approved && sendEmail && p) {
      if (emailjsReady && typeof emailjs !== 'undefined') {
        try {
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: p.email, to_name: p.name, surveyor_email: p.email, surveyor_name: p.name
          });
          showToast('📧 Approval email sent!');
        } catch (emailErr) {
          console.error('EmailJS send error:', emailErr);
          showToast('⚠️ Approved, but email failed: ' + (emailErr.text || emailErr.message || 'Unknown error'));
        }
      } else {
        const subject = encodeURIComponent('✅ Your Census Survey Account is Approved');
        const body = encodeURIComponent(`Dear ${p.name},\n\nYour account on the Census Survey Portal has been approved. You can now sign in and start submitting survey records.\n\nPortal: https://pbhil95.github.io/Census_2027/\n\nRegards,\nCensus Survey Administration`);
        window.open(`mailto:${p.email}?subject=${subject}&body=${body}`, '_blank');
      }
    }
    renderSurveyors();
    updateStats();
    if (!approved) showToast('❌ Surveyor revoked.');
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
    const { error } = await db.from('surveyor_profiles').update({ force_password_reset: true }).eq('id', id);
    if (error) throw error;
    showToast('🔑 Password reset triggered. User must set new password on next login.');
  } catch (e) {
    showToast('❌ Error: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '🔑 Reset Pwd';
}

// ═══════════════════════════════════════════════════════════
//  SURVEYS — Date Filter + Export + View
// ═══════════════════════════════════════════════════════════

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function firstDayOfMonth() {
  return new Date().toISOString().slice(0, 7) + '-01';
}

async function loadSurveys(from, to) {
  const el = document.getElementById('all-surveys-list');
  el.innerHTML = '<div class="empty-state">⏳ Loading surveys…</div>';

  try {
    let query = db.from('census_surveys').select('*').order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', from + 'T00:00:00');
    if (to) query = query.lte('created_at', to + 'T23:59:59');
    const { data, error } = await query;
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
    el.innerHTML = '<div class="empty-state">📭 No survey submissions for this period.</div>';
    return;
  }

  let html = `<table class="records-table"><thead><tr>
    <th>#</th><th>Date</th><th>Surveyor</th><th>Line No.</th><th>Building</th><th>House</th>
    <th>Head Name</th><th>Gender</th><th>Persons</th><th>Rooms</th><th>Mobile</th><th>Actions</th>
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
      <td><button class="action-btn" style="background:var(--indigo-sub);color:var(--indigo-lt);border:1px solid var(--indigo-border);padding:5px 12px;" onclick="openViewModal('${r.id}')">👁 View</button></td>
    </tr>`;
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

function applyAdminFilter() {
  const from = document.getElementById('admin-from').value;
  const to = document.getElementById('admin-to').value;
  loadSurveys(from, to);
}

function resetAdminFilter() {
  document.getElementById('admin-from').value = '';
  document.getElementById('admin-to').value = '';
  loadSurveys();
}

// ═══════════════════════════════════════════════════════════
//  VIEW REPORT MODAL
// ═══════════════════════════════════════════════════════════

const QUESTION_LABELS = [
  { key: 'q1_line_number', label: 'Q1. Line Number' },
  { key: 'q2_building_number', label: 'Q2. Building Number' },
  { key: 'q3_census_house_number', label: 'Q3. Census House Number' },
  { key: 'q4_floor_material', label: 'Q4. Floor Material' },
  { key: 'q5_wall_material', label: 'Q5. Wall Material' },
  { key: 'q6_roof_material', label: 'Q6. Roof Material' },
  { key: 'q7_house_usage', label: 'Q7. House Usage' },
  { key: 'q8_house_condition', label: 'Q8. House Condition' },
  { key: 'q9_family_serial', label: 'Q9. Family Serial No.' },
  { key: 'q10_persons_count', label: 'Q10. No. of Persons' },
  { key: 'q11_head_name', label: 'Q11. Head of Family' },
  { key: 'q12_gender', label: 'Q12. Gender' },
  { key: 'q13_category', label: 'Q13. Category' },
  { key: 'q14_ownership', label: 'Q14. Ownership Status' },
  { key: 'q15_rooms_count', label: 'Q15. No. of Rooms' },
  { key: 'q16_married_couples', label: 'Q16. Married Couples' },
  { key: 'q17_water_source', label: 'Q17. Drinking Water Source' },
  { key: 'q18_water_availability', label: 'Q18. Water Availability' },
  { key: 'q19_light_source', label: 'Q19. Light Source' },
  { key: 'q20_toilet_facility', label: 'Q20. Toilet Facility' },
  { key: 'q21_toilet_type', label: 'Q21. Toilet Type' },
  { key: 'q22_drainage', label: 'Q22. Waste Water Drainage' },
  { key: 'q23_bathing_facility', label: 'Q23. Bathing Facility' },
  { key: 'q24_kitchen_gas', label: 'Q24. Kitchen & Gas' },
  { key: 'q25_cooking_fuel', label: 'Q25. Cooking Fuel' },
  { key: 'q26_radio', label: 'Q26. Radio' },
  { key: 'q27_tv', label: 'Q27. TV' },
  { key: 'q28_internet', label: 'Q28. Internet' },
  { key: 'q29_laptop', label: 'Q29. Laptop/Computer' },
  { key: 'q30_phone', label: 'Q30. Phone/Mobile' },
  { key: 'q31_cycle_scooter', label: 'Q31. Cycle/Scooter' },
  { key: 'q32_car', label: 'Q32. Car/Jeep/Van' },
  { key: 'q33_main_grain', label: 'Q33. Main Grain' },
  { key: 'q34_mobile_number', label: 'Q34. Mobile Number' },
];

async function openViewModal(recordId) {
  const record = allSurveys.find(r => r.id === recordId);
  if (!record) return;

  const dt = new Date(record.created_at);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let html = `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--bd);">
    <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Submitted</div>
    <div style="font-weight:700;color:var(--t1);">${dateStr}</div>
    <div style="font-size:0.8rem;color:var(--t3);margin-top:2px;">Surveyor: ${escapeHtml(record.surveyor_email || '—')}</div>
  </div>`;

  html += '<div style="display:grid;grid-template-columns:1fr;gap:10px;">';
  QUESTION_LABELS.forEach(q => {
    const val = record[q.key];
    const displayVal = val !== null && val !== undefined && val !== '' ? String(val) : '—';
    html += `<div style="display:flex;gap:12px;padding:10px 12px;background:var(--bg-raised);border-radius:var(--r-md);border:1px solid var(--bd);">
      <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;min-width:140px;flex-shrink:0;padding-top:2px;">${q.label}</div>
      <div style="font-size:0.88rem;font-weight:600;color:var(--t1);word-break:break-word;">${escapeHtml(displayVal)}</div>
    </div>`;
  });
  html += '</div>';

  document.getElementById('view-modal-body').innerHTML = html;
  document.getElementById('modal-view-report').style.display = 'flex';
}

function closeViewModal() {
  document.getElementById('modal-view-report').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  EXCEL EXPORT
// ═══════════════════════════════════════════════════════════

function exportAdminExcel() {
  if (!allSurveys.length) { showToast('⚠️ No data to export.'); return; }
  if (typeof XLSX === 'undefined') { showToast('⚠️ Excel library not loaded yet.'); return; }

  const headers = ['#', 'Date', 'Surveyor', ...QUESTION_LABELS.map(q => q.label)];
  const rows = allSurveys.map((r, i) => {
    const dt = new Date(r.created_at);
    return [
      i + 1,
      dt.toLocaleDateString('en-IN') + ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      r.surveyor_email || '',
      ...QUESTION_LABELS.map(q => r[q.key] ?? '')
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All Surveys');

  const from = document.getElementById('admin-from').value || 'all';
  const to = document.getElementById('admin-to').value || 'all';
  XLSX.writeFile(wb, `Census_Surveys_${from}_to_${to}.xlsx`);
  showToast('✅ Excel exported successfully!');
}

// ═══════════════════════════════════════════════════════════
//  PDF EXPORT (Admin Table)
// ═══════════════════════════════════════════════════════════

async function exportAdminPDF() {
  if (!allSurveys.length) { showToast('⚠️ No data to export.'); return; }
  if (typeof jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    showToast('⚠️ PDF libraries not loaded yet.'); return;
  }

  const el = document.getElementById('all-surveys-list');
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');

  const { jsPDF } = jspdf;
  const pdf = new jsPDF('l', 'mm', 'a4');
  const imgWidth = 297;
  const pageHeight = 210;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  const from = document.getElementById('admin-from').value || 'all';
  const to = document.getElementById('admin-to').value || 'all';
  pdf.save(`Census_Surveys_${from}_to_${to}.pdf`);
  showToast('✅ PDF exported successfully!');
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
