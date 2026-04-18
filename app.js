// ═══════════════════════════════════════════════════════════
//  Census Survey App — Supabase-powered survey submission
// ═══════════════════════════════════════════════════════════

// ── Supabase Config ──
const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';

let db = null;
let currentUser = null;
let currentStep = 1;
const TOTAL_STEPS = 9;

const IS_CONFIGURED = !SUPABASE_URL.includes('YOUR_PROJECT_ID');

// Screens
const ST = {
  loading: document.getElementById('screen-loading'),
  auth: document.getElementById('screen-auth'),
  main: document.getElementById('screen-main'),
  success: document.getElementById('screen-success'),
  records: document.getElementById('screen-records')
};

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  if (!IS_CONFIGURED) {
    ST.loading.classList.add('hidden');
    showScreen('auth');
    const err = document.getElementById('err-login');
    if (err) {
      err.textContent = '⚠️ Please configure Supabase in app.js (SUPABASE_URL & SUPABASE_KEY)';
      err.classList.remove('hidden');
    }
    console.warn('Supabase not configured. Update SUPABASE_URL and SUPABASE_KEY in app.js');
    return;
  }

  try {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('Supabase init failed:', e);
    showToast('❌ Failed to connect to database');
    ST.loading.classList.add('hidden');
    showScreen('auth');
    return;
  }

  setupEventListeners();

  // Handle magic link / confirmation redirect from URL hash
  handleAuthRedirect();

  checkSession();

  // Safety net: hide loader after 5s
  setTimeout(() => {
    if (ST.loading && !ST.loading.classList.contains('hidden')) {
      ST.loading.classList.add('hidden');
      showScreen('auth');
    }
  }, 5000);
});

// ── Handle auth redirect (magic links, email confirmations) ──
async function handleAuthRedirect() {
  // Supabase JS v2 automatically processes hash tokens on init,
  // but we wait a moment then clean the URL so tokens don't linger.
  if (window.location.hash && window.location.hash.includes('access_token')) {
    // Give Supabase client a tick to process the session
    await new Promise(r => setTimeout(r, 500));
    // Clean URL without reloading
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  }
}

// ── AUTH ──
async function checkSession() {
  if (!db) { ST.loading.classList.add('hidden'); showScreen('auth'); return; }
  const { data: { session }, error } = await db.auth.getSession();
  if (error || !session) {
    ST.loading.classList.add('hidden');
    showScreen('auth');
  } else {
    currentUser = session.user;
    document.getElementById('surveyor-name').textContent = currentUser.email;
    ST.loading.classList.add('hidden');
    showScreen('main');
    updateProgress();
  }
}

async function login(email, password) {
  if (!db) return { error: { message: 'Database not initialized' } };
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (!error && data.user) {
    currentUser = data.user;
    document.getElementById('surveyor-name').textContent = currentUser.email;
    showScreen('main');
    updateProgress();
  }
  return { error };
}

async function register(email, password, name) {
  if (!db) return { error: { message: 'Database not initialized' } };
  const { data, error } = await db.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  return { error };
}

async function logout() {
  if (!db) return;
  await db.auth.signOut();
  currentUser = null;
  showScreen('auth');
}

// ── SCREEN NAVIGATION ──
function showScreen(key) {
  Object.keys(ST).forEach(k => {
    if (ST[k] && k !== 'loading') ST[k].classList.add('hidden');
  });
  if (ST[key]) ST[key].classList.remove('hidden');
  window.scrollTo(0, 0);
}

function switchAuthTab(type) {
  document.getElementById('tab-login').classList.toggle('active', type === 'login');
  document.getElementById('tab-register').classList.toggle('active', type === 'register');
  document.getElementById('form-login').classList.toggle('hidden', type !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', type !== 'register');
  document.getElementById('err-login').classList.add('hidden');
  document.getElementById('err-register').classList.add('hidden');
}

// ── WIZARD ──
function updateProgress() {
  const pct = (currentStep / TOTAL_STEPS) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;

  document.getElementById('btn-prev').classList.toggle('hidden', currentStep === 1);
  document.getElementById('btn-next').classList.toggle('hidden', currentStep === TOTAL_STEPS);
  document.getElementById('btn-submit').classList.toggle('hidden', currentStep !== TOTAL_STEPS);
}

function validateStep(step) {
  const container = document.querySelector(`.step[data-step="${step}"]`);
  if (!container) return true;

  const requiredInputs = container.querySelectorAll('input[required], select[required]');
  let valid = true;

  requiredInputs.forEach(input => {
    if (input.type === 'radio') {
      const name = input.name;
      const checked = container.querySelector(`input[name="${name}"]:checked`);
      if (!checked) valid = false;
    } else if (!input.value.trim()) {
      valid = false;
      input.style.borderColor = 'var(--rose)';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
    }
  });

  // Mobile number validation
  if (step === TOTAL_STEPS) {
    const mobile = document.getElementById('q34');
    if (mobile && mobile.value.trim()) {
      const m = mobile.value.trim();
      if (!/^\d{10}$/.test(m)) {
        showToast('⚠️ Mobile number must be exactly 10 digits');
        mobile.style.borderColor = 'var(--rose)';
        setTimeout(() => { mobile.style.borderColor = ''; }, 2000);
        return false;
      }
    }
  }

  return valid;
}

function nextStep() {
  if (!validateStep(currentStep)) {
    showToast('⚠️ Please fill all required fields');
    return;
  }
  if (currentStep < TOTAL_STEPS) {
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.add('hidden');
    currentStep++;
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.remove('hidden');
    updateProgress();
    window.scrollTo(0, 0);
  }
}

function prevStep() {
  if (currentStep > 1) {
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.add('hidden');
    currentStep--;
    document.querySelector(`.step[data-step="${currentStep}"]`).classList.remove('hidden');
    updateProgress();
    window.scrollTo(0, 0);
  }
}

// ── FORM SUBMIT ──
async function handleSubmit(e) {
  e.preventDefault();
  if (!validateStep(currentStep)) {
    showToast('⚠️ Please fill all required fields');
    return;
  }
  if (!db || !currentUser) {
    showToast('❌ Not logged in');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Submitting…';

  // Build payload
  const payload = {
    user_id: currentUser.id,
    surveyor_email: currentUser.email,
    q1_line_number: parseInt(document.getElementById('q1').value) || 0,
    q2_building_number: document.getElementById('q2').value.trim(),
    q3_census_house_number: document.getElementById('q3').value.trim(),
    q4_floor_material: document.querySelector('input[name="q4"]:checked')?.value || '',
    q5_wall_material: document.querySelector('input[name="q5"]:checked')?.value || '',
    q6_roof_material: document.querySelector('input[name="q6"]:checked')?.value || '',
    q7_house_usage: document.querySelector('input[name="q7"]:checked')?.value || '',
    q8_house_condition: document.querySelector('input[name="q8"]:checked')?.value || '',
    q9_family_serial: document.getElementById('q9').value.trim(),
    q10_persons_count: parseInt(document.getElementById('q10').value) || 0,
    q11_head_name: document.getElementById('q11').value.trim(),
    q12_gender: document.querySelector('input[name="q12"]:checked')?.value || '',
    q13_category: document.querySelector('input[name="q13"]:checked')?.value || '',
    q14_ownership: document.querySelector('input[name="q14"]:checked')?.value || '',
    q15_rooms_count: parseInt(document.getElementById('q15').value) || 0,
    q16_married_couples: parseInt(document.getElementById('q16').value) || 0,
    q17_water_source: document.querySelector('input[name="q17"]:checked')?.value || '',
    q18_water_availability: document.querySelector('input[name="q18"]:checked')?.value || '',
    q19_light_source: document.querySelector('input[name="q19"]:checked')?.value || '',
    q20_toilet_facility: document.querySelector('input[name="q20"]:checked')?.value || '',
    q21_toilet_type: document.querySelector('input[name="q21"]:checked')?.value || '',
    q22_drainage: document.querySelector('input[name="q22"]:checked')?.value || '',
    q23_bathing_facility: document.querySelector('input[name="q23"]:checked')?.value || '',
    q24_kitchen_gas: document.querySelector('input[name="q24"]:checked')?.value || '',
    q25_cooking_fuel: document.querySelector('input[name="q25"]:checked')?.value || '',
    q26_radio: document.querySelector('input[name="q26"]:checked')?.value || '',
    q27_tv: document.querySelector('input[name="q27"]:checked')?.value || '',
    q28_internet: document.querySelector('input[name="q28"]:checked')?.value || '',
    q29_laptop: document.querySelector('input[name="q29"]:checked')?.value || '',
    q30_phone: document.querySelector('input[name="q30"]:checked')?.value || '',
    q31_cycle_scooter: document.querySelector('input[name="q31"]:checked')?.value || '',
    q32_car: document.querySelector('input[name="q32"]:checked')?.value || '',
    q33_main_grain: document.querySelector('input[name="q33"]:checked')?.value || '',
    q34_mobile_number: document.getElementById('q34').value.trim(),
  };

  const { error } = await db.from('census_surveys').insert([payload]);

  btn.disabled = false;
  btn.innerHTML = '✅ Submit Survey';

  if (error) {
    showToast('❌ Error: ' + error.message);
  } else {
    const rows = [
      ['Surveyor', currentUser.email],
      ['Line No.', payload.q1_line_number],
      ['Building', payload.q2_building_number],
      ['Census House', payload.q3_census_house_number],
      ['Head of Family', payload.q11_head_name],
      ['Mobile', payload.q34_mobile_number]
    ];
    document.getElementById('suc-details').innerHTML = rows.map(([l, v]) =>
      `<div class="detail-row-item"><div class="detail-label">${l}</div><div class="detail-val">${v}</div></div>`
    ).join('');
    showScreen('success');
  }
}

function submitAnother() {
  document.getElementById('survey-form').reset();
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('hidden', i !== 0);
  });
  currentStep = 1;
  updateProgress();
  showScreen('main');
}

// ── RECORDS ──
async function openRecords() {
  showScreen('records');
  const body = document.getElementById('records-body');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">⏳ Loading…</div>';

  if (!db || !currentUser) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--rose-lt);">❌ Not logged in</div>';
    return;
  }

  try {
    const { data, error } = await db
      .from('census_surveys')
      .select('*')
      .eq('surveyor_email', currentUser.email)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">📭 No submissions yet.</div>';
      return;
    }

    let html = `<table class="records-table"><thead><tr>
      <th>#</th><th>Date</th><th>Line No.</th><th>Building</th><th>House</th>
      <th>Head Name</th><th>Persons</th><th>Mobile</th>
    </tr></thead><tbody>`;

    data.forEach((r, i) => {
      const dt = new Date(r.created_at);
      const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      html += `<tr>
        <td>${i + 1}</td>
        <td><div style="font-weight:600;">${date}</div><div style="font-size:0.7rem;color:var(--t3);">${time}</div></td>
        <td>${r.q1_line_number || '—'}</td>
        <td>${escapeHtml(r.q2_building_number || '—')}</td>
        <td>${escapeHtml(r.q3_census_house_number || '—')}</td>
        <td>${escapeHtml(r.q11_head_name || '—')}</td>
        <td>${r.q10_persons_count || '—'}</td>
        <td>${escapeHtml(r.q34_mobile_number || '—')}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--rose-lt);">❌ ${e.message}</div>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── EVENT LISTENERS ──
function setupEventListeners() {
  // Theme
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('census-theme', next);
      document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = next === 'dark' ? '☀' : '🌙');
    });
  });

  // Logout
  document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', () => logout());
  });

  // Login
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('log-email').value.trim();
    const pwd = document.getElementById('log-pwd').value;
    const btn = document.getElementById('btn-login');
    const err = document.getElementById('err-login');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Signing In…';
    const { error } = await login(email, pwd);
    if (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In →';
    }
  });

  // Register
  document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pwd = document.getElementById('reg-pwd').value;
    const confirm = document.getElementById('reg-pwd-confirm').value;
    const btn = document.getElementById('btn-register');
    const err = document.getElementById('err-register');
    err.classList.add('hidden');

    if (pwd !== confirm) { showError(err, 'Passwords do not match'); return; }
    if (pwd.length < 8) { showError(err, 'Password must be at least 8 characters'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Creating…';
    const { error } = await register(email, pwd, name);
    if (error) {
      showError(err, error.message);
      btn.disabled = false;
      btn.textContent = 'Create Account →';
    } else {
      showToast('✅ Account created! Please check your email to verify.');
      switchAuthTab('login');
      btn.disabled = false;
      btn.textContent = 'Create Account →';
    }
  });

  // Survey form
  document.getElementById('survey-form').addEventListener('submit', handleSubmit);

  // Enter key on inputs should not submit, only buttons
  document.querySelectorAll('.form-input, .form-select').forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentStep < TOTAL_STEPS) nextStep();
      }
    });
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showToast(msg) {
  const t = document.getElementById('global-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
