// ═══════════════════════════════════════════════════════════
//  Census Survey App — Supabase-powered survey submission
// ═══════════════════════════════════════════════════════════

// ── Supabase Config ──
const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';

// Capture recovery hash BEFORE Supabase client consumes it
const URL_HAS_RECOVERY = window.location.hash.includes('type=recovery');

let db = null;
let currentUser = null;
let currentProfile = null;
let recoveryMode = false;
let currentStep = 1;
const TOTAL_STEPS = 9;

const IS_CONFIGURED = !SUPABASE_URL.includes('YOUR_PROJECT_ID');

// Screens
const ST = {
  loading: document.getElementById('screen-loading'),
  auth: document.getElementById('screen-auth'),
  wait: document.getElementById('screen-wait'),
  main: document.getElementById('screen-main'),
  success: document.getElementById('screen-success'),
  records: document.getElementById('screen-records'),
  forceReset: document.getElementById('screen-force-reset')
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
  initAuth();

  // Safety net: hide loader after 5s
  setTimeout(() => {
    if (ST.loading && !ST.loading.classList.contains('hidden')) {
      ST.loading.classList.add('hidden');
      showScreen('auth');
    }
  }, 5000);
});

// ── AUTH FLOW ──
async function initAuth() {
  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) console.error('getSession error:', error.message);

    if (session) {
      currentUser = session.user;
      currentProfile = await loadProfile(currentUser);
    }
  } catch (err) {
    console.error('initAuth error:', err.message);
  }

  // If this is a recovery link, force recovery mode so routeUser shows reset screen
  if (URL_HAS_RECOVERY) {
    recoveryMode = true;
    // Clean the URL so refresh doesn't trigger recovery again
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  }

  routeUser();

  // Listen for auth state changes
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;

    if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      recoveryMode = false;
      stopApprovalWatcher();
      showScreen('auth');
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (!session) return;
      currentUser = session.user;
      currentProfile = await loadProfile(currentUser);
      routeUser();
    } else if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      if (session) {
        currentUser = session.user;
        currentProfile = await loadProfile(currentUser);
      }
      routeUser();
    }
  });
}

async function loadProfile(user) {
  try {
    const { data: profile, error } = await db
      .from('surveyor_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('loadProfile error:', error.message);
    }

    // If no profile exists, create one with approved: false
    if (!profile) {
      const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
      const { data: newProfile, error: insErr } = await db
        .from('surveyor_profiles')
        .insert([{ id: user.id, name, email: user.email }])
        .select()
        .single();

      if (insErr) {
        console.error('createProfile error:', insErr.message);
        return null;
      }
      return newProfile;
    }

    return profile;
  } catch (err) {
    console.error('loadProfile caught:', err.message);
    return null;
  }
}

function routeUser() {
  ST.loading.classList.add('fade-out');
  setTimeout(() => ST.loading.classList.add('hidden'), 300);

  if (!currentUser) {
    stopApprovalWatcher();
    showScreen('auth');
  } else if (!currentProfile) {
    stopApprovalWatcher();
    document.getElementById('wait-name').textContent = 'Profile Data Missing';
    const p = document.querySelector('#screen-wait .wait-desc');
    if (p) p.innerHTML = 'Your profile data could not be found. <b>Please run the SQL setup script in Supabase.</b>';
    showScreen('wait');
  } else if (!currentProfile.approved) {
    document.getElementById('wait-name').textContent = currentProfile.name || currentUser.email;
    showScreen('wait');
    startApprovalWatcher();
  } else if (currentProfile.force_password_reset || recoveryMode) {
    stopApprovalWatcher();
    document.getElementById('force-reset-name').textContent = currentProfile.name || currentUser.email;
    showScreen('forceReset');
  } else {
    stopApprovalWatcher();
    document.getElementById('surveyor-name').textContent = currentProfile.name || currentUser.email;
    showScreen('main');
  }
}

// ── REAL-TIME APPROVAL WATCHER ──
let _approvalChannel = null;

function startApprovalWatcher() {
  if (_approvalChannel) return;
  if (!currentUser) return;

  _approvalChannel = db
    .channel('approval-watch-' + currentUser.id)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'surveyor_profiles',
      filter: `id=eq.${currentUser.id}`
    }, (payload) => {
      if (payload.new && payload.new.approved) {
        stopApprovalWatcher();
        currentProfile = payload.new;
        showToast('✅ Your account has been approved! Welcome!');
        routeUser();
      }
    })
    .subscribe((status) => {
      console.log('Approval channel status:', status);
    });
}

function stopApprovalWatcher() {
  if (_approvalChannel) {
    db.removeChannel(_approvalChannel);
    _approvalChannel = null;
  }
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

  const frmLogin = document.getElementById('form-login');
  const frmReg = document.getElementById('form-register');
  const frmForgot = document.getElementById('form-forgot');

  if (frmLogin) frmLogin.classList.toggle('hidden', type !== 'login');
  if (frmReg) frmReg.classList.toggle('hidden', type !== 'register');
  if (frmForgot) frmForgot.classList.toggle('hidden', type !== 'forgot');

  if (type === 'forgot') {
    document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
  }

  document.getElementById('err-login').classList.add('hidden');
  document.getElementById('err-register').classList.add('hidden');
  const errF = document.getElementById('err-forgot');
  const succF = document.getElementById('succ-forgot');
  if (errF) errF.classList.add('hidden');
  if (succF) succF.classList.add('hidden');
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

  if (step === TOTAL_STEPS) {
    const mobile = document.getElementById('q34');
    if (mobile && mobile.value.trim()) {
      if (!/^\d{10}$/.test(mobile.value.trim())) {
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

// ── FORCE RESET ──
async function handleForceReset(e) {
  e.preventDefault();
  const newPwd = document.getElementById('fr-new-pwd').value;
  const confirm = document.getElementById('fr-confirm-pwd').value;
  const err = document.getElementById('fr-err');
  const btn = document.getElementById('btn-force-reset');

  err.classList.add('hidden');
  if (newPwd.length < 8) return showError(err, 'Password must be at least 8 characters');
  if (newPwd !== confirm) return showError(err, 'Passwords do not match');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Saving…';

  try {
    const { error: pwdErr } = await db.auth.updateUser({ password: newPwd });
    if (pwdErr) throw pwdErr;

    const { error: dbErr } = await db
      .from('surveyor_profiles')
      .update({ force_password_reset: false })
      .eq('id', currentUser.id);
    if (dbErr) throw dbErr;

    if (currentProfile) currentProfile.force_password_reset = false;
    recoveryMode = false;
    showToast('✅ Password updated successfully!');
    routeUser();
  } catch (ex) {
    showError(err, ex.message);
  }

  btn.disabled = false;
  btn.textContent = 'Set New Password →';
}

// ── CHANGE PASSWORD MODAL ──
function openChangePwdModal() {
  document.getElementById('cp-new-pwd').value = '';
  document.getElementById('cp-confirm-pwd').value = '';
  document.getElementById('cp-strength-fill').style.width = '0%';
  document.getElementById('cp-strength-label').textContent = '';
  document.getElementById('cp-err').classList.add('hidden');
  document.getElementById('cp-success').classList.add('hidden');
  document.getElementById('modal-change-pwd').style.display = 'flex';
}

function closeChangePwdModal() {
  document.getElementById('modal-change-pwd').style.display = 'none';
}

async function handleChangePwd(e) {
  e.preventDefault();
  const newPwd = document.getElementById('cp-new-pwd').value;
  const confirm = document.getElementById('cp-confirm-pwd').value;
  const err = document.getElementById('cp-err');
  const success = document.getElementById('cp-success');
  const btn = document.getElementById('btn-change-pwd');

  err.classList.add('hidden');
  success.classList.add('hidden');
  if (newPwd.length < 8) return showError(err, 'Password must be at least 8 characters');
  if (newPwd !== confirm) return showError(err, 'Passwords do not match');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Updating…';

  try {
    const { error } = await db.auth.updateUser({ password: newPwd });
    if (error) throw error;
    success.textContent = '✅ Password changed successfully!';
    success.classList.remove('hidden');
    document.getElementById('cp-new-pwd').value = '';
    document.getElementById('cp-confirm-pwd').value = '';
    setTimeout(closeChangePwdModal, 2000);
  } catch (ex) {
    showError(err, ex.message);
  }

  btn.disabled = false;
  btn.textContent = '🔒 Update Password';
}

// ── PASSWORD STRENGTH ──
function updatePwdStrength(pwd, fillId, labelId) {
  const fill = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  if (!fill || !label) return;

  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  const levels = [
    { pct: '0%', color: 'transparent', text: '' },
    { pct: '25%', color: 'var(--rose)', text: 'Weak' },
    { pct: '50%', color: 'var(--amber)', text: 'Fair' },
    { pct: '75%', color: 'var(--cyan)', text: 'Good' },
    { pct: '100%', color: 'var(--emerald)', text: 'Strong ✓' },
  ];
  const lv = levels[score];
  fill.style.width = lv.pct;
  fill.style.background = lv.color;
  label.textContent = lv.text;
  label.style.color = lv.color;
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
      .eq('user_id', currentUser.id)
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
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      ST.loading.classList.remove('fade-out', 'hidden');
      try { await db.auth.signOut(); } catch (e) {}
      currentUser = null;
      currentProfile = null;
      recoveryMode = false;
      stopApprovalWatcher();
      showScreen('auth');
      ST.loading.classList.add('fade-out');
      setTimeout(() => ST.loading.classList.add('hidden'), 300);
      btn.disabled = false;
    });
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

    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password: pwd });
      if (error) throw error;
      currentUser = data.user;
      currentProfile = await loadProfile(currentUser);
      routeUser();
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'Sign In →';
  });

  // Forgot Password
  document.getElementById('form-forgot')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const btn = document.getElementById('btn-forgot');
    const err = document.getElementById('err-forgot');
    const succ = document.getElementById('succ-forgot');

    err.classList.add('hidden');
    succ.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Sending Link…';

    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      succ.textContent = 'Reset link sent! Check your email inbox (and spam folder).';
      succ.classList.remove('hidden');
      document.getElementById('forgot-email').value = '';
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'Send Reset Link →';
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

    try {
      const { data, error } = await db.auth.signUp({
        email, password,
        options: { data: { full_name: name, name } }
      });
      if (error) throw error;

      // Auto-create profile and show wait screen
      if (data.user) {
        currentUser = data.user;
        currentProfile = await loadProfile(currentUser);
        showToast('✅ Account created! Waiting for admin approval.');
        routeUser();
      }
    } catch (error) {
      showError(err, error.message);
      btn.disabled = false;
      btn.textContent = 'Create Account →';
    }
  });

  // Survey form
  document.getElementById('survey-form').addEventListener('submit', handleSubmit);

  // Refresh status
  document.getElementById('btn-refresh-status')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-status');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Checking…';

    try {
      const { data: row } = await db
        .from('surveyor_profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (row && row.approved) {
        currentProfile = row;
        showToast('✅ Account approved! Redirecting…');
        routeUser();
      } else {
        const desc = document.querySelector('#screen-wait .wait-desc');
        if (desc) {
          desc.style.color = 'var(--rose-lt)';
          desc.textContent = 'Still pending approval. Try again later.';
          setTimeout(() => {
            desc.style.color = '';
            desc.textContent = 'Your account is created. An administrator needs to approve your profile before you can submit survey records.';
          }, 3000);
        }
      }
    } catch (e) {
      console.error('Check status error:', e);
    }

    btn.disabled = false;
    btn.textContent = '🔄 Check Status';
  });

  // Force reset
  document.getElementById('form-force-reset')?.addEventListener('submit', handleForceReset);

  // Change pwd
  document.getElementById('form-change-pwd')?.addEventListener('submit', handleChangePwd);

  // Pwd strength listeners
  document.getElementById('fr-new-pwd')?.addEventListener('input', (e) => {
    updatePwdStrength(e.target.value, 'fr-strength-fill', 'fr-strength-label');
  });
  document.getElementById('cp-new-pwd')?.addEventListener('input', (e) => {
    updatePwdStrength(e.target.value, 'cp-strength-fill', 'cp-strength-label');
  });

  // Enter key on inputs
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
