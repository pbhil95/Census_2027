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

  // Show the floating toggle only on screens that have NO app-header of their own.
  // main / records / success already have a toggle in their header.
  const authToggle = document.getElementById('auth-theme-toggle');
  if (authToggle) {
    const headerlessScreens = ['auth', 'wait', 'forceReset'];
    authToggle.style.display = headerlessScreens.includes(key) ? '' : 'none';
  }

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
  document.getElementById('btn-cancel-edit').classList.toggle('hidden', !_editingRecordId);
}

function showWizardStep(step) {
  document.querySelectorAll('.step').forEach(s => {
    s.classList.toggle('hidden', Number(s.dataset.step) !== step);
  });
  currentStep = step;
  updateProgress();
  window.scrollTo(0, 0);
}

function escapeSelector(value) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function fieldGroupFor(control) {
  return control?.closest('.form-group') || null;
}

function getFieldLabel(group) {
  const label = group?.querySelector('.form-label');
  if (!label) return 'This field';
  return label.textContent.replace('*', '').replace(/\s+/g, ' ').trim();
}

function getFieldErrorNode(group) {
  let node = group.querySelector('.field-error');
  if (!node) {
    node = document.createElement('div');
    node.className = 'field-error';
    node.setAttribute('role', 'alert');
    group.appendChild(node);
  }
  return node;
}

function setFieldError(control, message) {
  const group = fieldGroupFor(control);
  if (!group) return;

  const errorNode = getFieldErrorNode(group);
  if (!errorNode.id) {
    const key = control.name || control.id || Math.random().toString(36).slice(2);
    errorNode.id = `err-${key}`;
  }

  group.classList.add('has-error');
  errorNode.textContent = message;

  if (control.type === 'radio') {
    const radios = group.querySelectorAll(`input[type="radio"][name="${escapeSelector(control.name)}"]`);
    radios.forEach(radio => {
      radio.setAttribute('aria-invalid', 'true');
      radio.setAttribute('aria-describedby', errorNode.id);
    });
    group.querySelector('.radio-group')?.classList.add('has-error');
  } else {
    control.classList.add('is-invalid');
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', errorNode.id);
  }
}

function clearFieldError(control) {
  const group = fieldGroupFor(control);
  if (!group) return;

  group.classList.remove('has-error');
  const errorNode = group.querySelector('.field-error');
  if (errorNode) errorNode.textContent = '';

  if (control.type === 'radio') {
    const radios = group.querySelectorAll(`input[type="radio"][name="${escapeSelector(control.name)}"]`);
    radios.forEach(radio => {
      radio.removeAttribute('aria-invalid');
      radio.removeAttribute('aria-describedby');
    });
    group.querySelector('.radio-group')?.classList.remove('has-error');
  } else {
    control.classList.remove('is-invalid');
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

function validationMessageForInput(input) {
  const value = input.value.trim();
  const label = getFieldLabel(fieldGroupFor(input));

  if (input.required && !value) return `${label} is required.`;
  if (!value) return '';

  if (input.id === 'q34' && !/^[6-9]\d{9}$/.test(value)) {
    return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
  }

  if (input.type === 'number') {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return 'Enter a valid number.';
    if (input.min !== '' && numericValue < Number(input.min)) return `Value must be ${input.min} or more.`;
    if (input.max !== '' && numericValue > Number(input.max)) return `Value must be ${input.max} or less.`;
  }

  if (input.type === 'email' && !input.checkValidity()) return 'Enter a valid email address.';
  if (input.minLength > 0 && value.length < input.minLength) {
    return `Enter at least ${input.minLength} characters.`;
  }
  if (input.pattern && !input.checkValidity()) return 'Enter a valid value.';

  return '';
}

function validateInput(input, showErrorState = true) {
  const message = validationMessageForInput(input);
  if (message) {
    if (showErrorState) setFieldError(input, message);
    return false;
  }
  clearFieldError(input);
  return true;
}

function validateRadioGroup(name, container, showErrorState = true) {
  const firstRadio = container.querySelector(`input[type="radio"][name="${escapeSelector(name)}"]`);
  if (!firstRadio) return true;

  const checked = container.querySelector(`input[type="radio"][name="${escapeSelector(name)}"]:checked`);
  if (!checked) {
    if (showErrorState) setFieldError(firstRadio, 'Please choose one option.');
    return false;
  }

  clearFieldError(firstRadio);
  return true;
}

function focusFirstInvalid(container) {
  const firstInvalid = container.querySelector('.form-group.has-error input, .form-group.has-error select');
  if (!firstInvalid) return;

  firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (firstInvalid.type !== 'radio') {
    setTimeout(() => firstInvalid.focus({ preventScroll: true }), 250);
  }
}

function clearFormValidation() {
  document.querySelectorAll('#survey-form .has-error').forEach(el => el.classList.remove('has-error'));
  document.querySelectorAll('#survey-form .is-invalid').forEach(el => el.classList.remove('is-invalid'));
  document.querySelectorAll('#survey-form .field-error').forEach(el => { el.textContent = ''; });
  document.querySelectorAll('#survey-form [aria-invalid]').forEach(el => {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
  });
}

function validateStep(step, options = {}) {
  const container = document.querySelector(`.step[data-step="${step}"]`);
  if (!container) return true;

  const requiredInputs = container.querySelectorAll('input[required]:not([type="radio"]), select[required]');
  const requiredRadioNames = [...new Set(
    Array.from(container.querySelectorAll('input[type="radio"][required]')).map(input => input.name)
  )];
  let valid = true;

  requiredInputs.forEach(input => {
    if (!validateInput(input, true)) valid = false;
  });

  requiredRadioNames.forEach(name => {
    if (!validateRadioGroup(name, container, true)) valid = false;
  });

  if (!valid && options.focus !== false) focusFirstInvalid(container);

  return valid;
}

function getFirstInvalidSurveyStep() {
  for (let step = 1; step <= TOTAL_STEPS; step++) {
    if (!validateStep(step, { focus: false })) return step;
  }
  return null;
}

function nextStep() {
  if (!validateStep(currentStep)) {
    showToast('Please complete the highlighted fields.');
    return;
  }
  if (currentStep < TOTAL_STEPS) {
    showWizardStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 1) {
    showWizardStep(currentStep - 1);
  }
}

// ── FORM SUBMIT (Insert or Update) ──
async function handleSubmit(e) {
  e.preventDefault();
  const invalidStep = getFirstInvalidSurveyStep();
  if (invalidStep) {
    showWizardStep(invalidStep);
    const container = document.querySelector(`.step[data-step="${invalidStep}"]`);
    setTimeout(() => focusFirstInvalid(container), 100);
    showToast('Please complete the highlighted fields.');
    return;
  }
  if (!db || !currentUser) {
    showToast('❌ Not logged in');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> ' + (_editingRecordId ? 'Updating…' : 'Submitting…');

  const payload = {
    user_id: currentUser.id,
    surveyor_email: currentUser.email,
    q1_line_number: parseInt(document.getElementById('q1').value, 10) || null,
    q2_building_number: document.getElementById('q2').value.trim(),
    q3_census_house_number: document.getElementById('q3').value.trim(),
    q4_floor_material: document.querySelector('input[name="q4"]:checked')?.value || '',
    q5_wall_material: document.querySelector('input[name="q5"]:checked')?.value || '',
    q6_roof_material: document.querySelector('input[name="q6"]:checked')?.value || '',
    q7_house_usage: document.querySelector('input[name="q7"]:checked')?.value || '',
    q8_house_condition: document.querySelector('input[name="q8"]:checked')?.value || '',
    q9_family_serial: document.getElementById('q9').value.trim(),
    q10_persons_count: parseInt(document.getElementById('q10').value, 10) || null,
    q11_head_name: document.getElementById('q11').value.trim(),
    q12_gender: document.querySelector('input[name="q12"]:checked')?.value || '',
    q13_category: document.querySelector('input[name="q13"]:checked')?.value || '',
    q14_ownership: document.querySelector('input[name="q14"]:checked')?.value || '',
    q15_rooms_count: parseInt(document.getElementById('q15').value, 10) || null,
    q16_married_couples: parseInt(document.getElementById('q16').value, 10) || null,
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

  let error = null;
  try {
    const dbPromise = _editingRecordId
      ? db.from('census_surveys').update(payload).eq('id', _editingRecordId)
      : db.from('census_surveys').insert([payload]);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000)
    );

    const result = await Promise.race([dbPromise, timeoutPromise]);
    if (result.error) error = result.error;
  } catch (err) {
    error = err;
  }

  btn.disabled = false;
  btn.innerHTML = _editingRecordId ? '💾 Update Survey' : '✅ Submit Survey';

  if (error) {
    showToast('❌ Error: ' + (error.message || 'Unknown error'));
    console.error('Submit error:', error);
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

    if (_editingRecordId) {
      _editingRecordId = null;
      btn.innerHTML = '✅ Submit Survey';
      showToast('✅ Record updated successfully!');
    }
    showScreen('success');
  }
}

function submitAnother() {
  document.getElementById('survey-form').reset();
  clearFormValidation();
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('hidden', i !== 0);
  });
  currentStep = 1;
  updateProgress();
  _editingRecordId = null;
  document.getElementById('btn-submit').innerHTML = '✅ Submit Survey';
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

// ═══════════════════════════════════════════════════════════
//  MY RECORDS — Date Filter + Export + View/Edit
// ═══════════════════════════════════════════════════════════
let _myRecordsCache = [];
let _editingRecordId = null;

async function openRecords() {
  showScreen('records');
  await loadMyRecords();
}

async function loadMyRecords(from, to) {
  const body = document.getElementById('records-body');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">⏳ Loading…</div>';

  if (!db || !currentUser) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--rose-lt);">❌ Not logged in</div>';
    return;
  }

  try {
    let query = db.from('census_surveys').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', from + 'T00:00:00+05:30'); // IST offset
    if (to) query = query.lte('created_at', to + 'T23:59:59+05:30');     // IST offset

    const { data, error } = await query;
    if (error) throw error;

    _myRecordsCache = data || [];

    if (!_myRecordsCache.length) {
      body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">📭 No submissions for this period.</div>';
      return;
    }

    let html = `<table class="records-table"><thead><tr>
      <th>#</th><th>Date</th><th>Line No.</th><th>Building</th><th>House</th>
      <th>Head Name</th><th>Persons</th><th>Mobile</th><th>Actions</th>
    </tr></thead><tbody>`;

    _myRecordsCache.forEach((r, i) => {
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
        <td>
          <button class="action-btn" style="background:var(--indigo-sub);color:var(--indigo-lt);border:1px solid var(--indigo-border);padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;" onclick="openUserViewModal('${r.id}')">👁 View</button>
          <button class="action-btn" style="background:var(--amber-sub);color:var(--amber-lt);border:1px solid var(--amber-border);padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;margin-left:4px;" onclick="startEditRecord('${r.id}')">✏️ Edit</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--rose-lt);">❌ ${e.message}</div>`;
  }
}

function applyMyFilter() {
  const from = document.getElementById('my-from').value;
  const to = document.getElementById('my-to').value;
  loadMyRecords(from, to);
}

function resetMyFilter() {
  document.getElementById('my-from').value = '';
  document.getElementById('my-to').value = '';
  loadMyRecords();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════
//  QUESTION LABELS (for exports, view modals, etc.)
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

// ── EVENT LISTENERS ──
function setupEventListeners() {
  // Theme
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('census-theme', next);
      document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = next === 'dark' ? '☀️' : '🌙');
    });
  });

  // Logout — Optimistic pattern: clear local state FIRST for instant response,
  // then sign out from Supabase in the background with a timeout safety net.
  document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;

      // ── Step 1: Instant local logout (no waiting) ──
      currentUser = null;
      currentProfile = null;
      recoveryMode = false;
      stopApprovalWatcher();
      showScreen('auth');                          // User sees login screen immediately

      // ── Step 2: Tell Supabase to invalidate the session (best-effort, background) ──
      try {
        const signOutPromise = db ? db.auth.signOut() : Promise.resolve();
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('signOut timed out')), 5000)
        );
        await Promise.race([signOutPromise, timeout]);
      } catch (e) {
        // Network is down or timed out — local state is already cleared, nothing to do
        console.warn('SignOut background error (user already logged out locally):', e.message);
      } finally {
        btn.disabled = false;
      }
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
        email, password: pwd,
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
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account →';
    }
  });

  // Survey form
  const surveyForm = document.getElementById('survey-form');
  surveyForm.setAttribute('novalidate', 'novalidate');
  surveyForm.addEventListener('submit', handleSubmit);
  setupSurveyValidation();

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
  document.querySelectorAll('#survey-form .form-input, #survey-form .form-select').forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentStep < TOTAL_STEPS) {
          nextStep();
        } else {
          document.getElementById('survey-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    });
  });
}

function setupSurveyValidation() {
  document.querySelectorAll('#survey-form .form-input, #survey-form .form-select').forEach(input => {
    input.addEventListener('input', () => {
      if (input.id === 'q34') input.value = input.value.replace(/\D/g, '').slice(0, 10);
      if (fieldGroupFor(input)?.classList.contains('has-error')) validateInput(input, true);
    });
    input.addEventListener('blur', () => validateInput(input, true));
  });

  document.querySelectorAll('#survey-form input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const container = radio.closest('.step') || document;
      validateRadioGroup(radio.name, container, true);
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  VIEW REPORT MODAL (User)
// ═══════════════════════════════════════════════════════════

function openUserViewModal(recordId) {
  const record = _myRecordsCache.find(r => r.id === recordId);
  if (!record) return;

  const dt = new Date(record.created_at);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let html = `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--bd);">
    <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Submitted</div>
    <div style="font-weight:700;color:var(--t1);">${dateStr}</div>
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

  document.getElementById('user-view-modal-body').innerHTML = html;
  document.getElementById('modal-view-report').style.display = 'flex';
}

function closeUserViewModal() {
  document.getElementById('modal-view-report').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  EDIT REPORT FLOW
// ═══════════════════════════════════════════════════════════

async function startEditRecord(recordId) {
  const record = _myRecordsCache.find(r => r.id === recordId);
  if (!record) return;

  _editingRecordId = recordId;
  document.getElementById('survey-form').reset();
  clearFormValidation();
  loadRecordIntoWizard(record);

  // Reset to step 1 and show main screen
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('hidden', i !== 0));
  currentStep = 1;
  updateProgress();
  showScreen('main');

  // Change submit button text
  const btn = document.getElementById('btn-submit');
  btn.innerHTML = '💾 Update Survey';

  showToast('✏️ Editing record. Make changes and submit.');
}

function loadRecordIntoWizard(record) {
  const textMap = {
    q1: 'q1_line_number',
    q2: 'q2_building_number',
    q3: 'q3_census_house_number',
    q9: 'q9_family_serial',
    q10: 'q10_persons_count',
    q11: 'q11_head_name',
    q15: 'q15_rooms_count',
    q16: 'q16_married_couples',
    q34: 'q34_mobile_number',
  };
  Object.entries(textMap).forEach(([id, col]) => {
    const el = document.getElementById(id);
    if (el) el.value = record[col] ?? '';
  });

  const radioMap = {
    q4: 'q4_floor_material',
    q5: 'q5_wall_material',
    q6: 'q6_roof_material',
    q7: 'q7_house_usage',
    q8: 'q8_house_condition',
    q12: 'q12_gender',
    q13: 'q13_category',
    q14: 'q14_ownership',
    q17: 'q17_water_source',
    q18: 'q18_water_availability',
    q19: 'q19_light_source',
    q20: 'q20_toilet_facility',
    q21: 'q21_toilet_type',
    q22: 'q22_drainage',
    q23: 'q23_bathing_facility',
    q24: 'q24_kitchen_gas',
    q25: 'q25_cooking_fuel',
    q26: 'q26_radio',
    q27: 'q27_tv',
    q28: 'q28_internet',
    q29: 'q29_laptop',
    q30: 'q30_phone',
    q31: 'q31_cycle_scooter',
    q32: 'q32_car',
    q33: 'q33_main_grain',
  };
  Object.entries(radioMap).forEach(([name, col]) => {
    const val = record[col];
    if (val) {
      const rb = document.querySelector(`input[name="${name}"][value="${CSS.escape(val)}"]`);
      if (rb) rb.checked = true;
    }
  });
}

function cancelEdit() {
  _editingRecordId = null;
  document.getElementById('survey-form').reset();
  clearFormValidation();
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('hidden', i !== 0));
  currentStep = 1;
  updateProgress();
  document.getElementById('btn-submit').innerHTML = '✅ Submit Survey';
  showToast('❌ Edit cancelled.');
}

// ═══════════════════════════════════════════════════════════
//  EXCEL EXPORT (User)
// ═══════════════════════════════════════════════════════════

function exportMyExcel() {
  if (!_myRecordsCache.length) { showToast('⚠️ No data to export.'); return; }
  if (typeof XLSX === 'undefined') { showToast('⚠️ Excel library not loaded yet.'); return; }

  const headers = ['#', 'Date', ...QUESTION_LABELS.map(q => q.label)];
  const rows = _myRecordsCache.map((r, i) => {
    const dt = new Date(r.created_at);
    return [
      i + 1,
      dt.toLocaleDateString('en-IN') + ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      ...QUESTION_LABELS.map(q => r[q.key] ?? '')
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Surveys');

  const from = document.getElementById('my-from').value || 'all';
  const to = document.getElementById('my-to').value || 'all';
  const name = currentUser?.email?.split('@')[0] || 'Surveyor';
  XLSX.writeFile(wb, `Census_MySurveys_${name}_${from}_to_${to}.xlsx`);
  showToast('✅ Excel exported successfully!');
}

// ═══════════════════════════════════════════════════════════
//  PDF EXPORT (User) — Single branded page per survey via html2canvas
// ═══════════════════════════════════════════════════════════

async function exportMyPDF() {
  if (!_myRecordsCache.length) { showToast('⚠️ No data to export.'); return; }
  if (typeof jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    showToast('⚠️ PDF libraries not loaded yet.'); return;
  }

  const { jsPDF } = jspdf;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;

  // Off-screen render container
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  document.body.appendChild(container);

  for (let i = 0; i < _myRecordsCache.length; i++) {
    const record = _myRecordsCache[i];

    const dt = new Date(record.created_at);
    const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    let rowsHtml = '';
    QUESTION_LABELS.forEach((q, idx) => {
      const val = record[q.key] !== null && record[q.key] !== undefined ? String(record[q.key]) : '—';
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      rowsHtml += `
        <tr style="background:${bg};">
          <td style="padding:5px 14px;border-bottom:1px solid #e2e8f0;width:52%;color:#4f46e5;font-weight:700;font-size:13px;line-height:1.4;">${escapeHtml(q.label)}</td>
          <td style="padding:5px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:13px;line-height:1.4;word-break:break-word;">${escapeHtml(val)}</td>
        </tr>`;
    });

    container.innerHTML = `
      <div style="font-family:'Noto Sans Devanagari','Segoe UI',system-ui,sans-serif;color:#334155;background:#fff;padding:28px 32px 16px;">
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:800;font-size:20px;letter-spacing:-0.3px;">
          📋 Census Survey Report
        </div>
        <div style="padding:10px 18px;background:#f1f5f9;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;">
          <span>Submitted: <strong style="color:#475569;">${dateStr} ${timeStr}</strong></span>
          <span>Surveyor: <strong style="color:#475569;">${escapeHtml(record.surveyor_email || '—')}</strong></span>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-top:2px;">
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="margin-top:10px;text-align:center;font-size:11px;color:#94a3b8;letter-spacing:0.3px;">
          Generated by Census Survey Portal
        </div>
      </div>
    `;

    await new Promise(r => setTimeout(r, 80));

    const canvas = await html2canvas(container.firstElementChild, {
      scale: 1.5,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    const imgHeight = (canvas.height * contentWidth) / canvas.width;

    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, margin, contentWidth, imgHeight); // matches toDataURL('image/jpeg')
  }

  document.body.removeChild(container);

  const from = document.getElementById('my-from').value || 'all';
  const to = document.getElementById('my-to').value || 'all';
  const name = currentUser?.email?.split('@')[0] || 'Surveyor';
  pdf.save(`Census_Reports_${name}_${from}_to_${to}.pdf`);
  showToast('✅ PDF exported successfully!');
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
