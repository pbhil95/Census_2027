// ═══════════════════════════════════════════════════════════
//  Census Survey App — Supabase-powered survey submission
// ═══════════════════════════════════════════════════════════

// ── Supabase Config ──
const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';

// ── Deploy URL (used for share links & QR codes) ──
// Change this to match your actual deployed URL:
const DEPLOY_BASE_URL = 'https://pbhil95.github.io/Census_2027';

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
    startSurveyStatusWatcher();
    document.getElementById('surveyor-name').textContent = currentProfile.name || currentUser.email;
    generateShareLink();
    showScreen('main');
  }
}

// ── REAL-TIME APPROVAL WATCHER ──
let _approvalChannel = null;
let _approvalPollInterval = null;

function startApprovalWatcher() {
  if (!currentUser) return;

  // 1. Real-time channel (instant when it works)
  if (!_approvalChannel) {
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
      .subscribe((status, err) => {
        console.log('Approval channel status:', status);
        if (err) console.error('Approval channel error:', err);
        if (status !== 'SUBSCRIBED') {
          console.warn('Realtime not subscribed — falling back to polling only.');
        }
      });
  }

  // 2. Fallback polling every 5 seconds (works even if realtime is disabled)
  if (!_approvalPollInterval) {
    _approvalPollInterval = setInterval(async () => {
      if (!currentUser || !currentProfile || currentProfile.approved) {
        stopApprovalWatcher();
        return;
      }
      try {
        const { data: rows, error } = await db
          .from('surveyor_profiles')
          .select('approved, name, email, link_code')
          .eq('id', currentUser.id)
          .limit(1);
        if (error) {
          console.error('Approval poll query error:', error);
          return;
        }
        const row = rows?.[0];
        if (row && row.approved) {
          stopApprovalWatcher();
          currentProfile = { ...currentProfile, ...row };
          showToast('✅ Your account has been approved! Welcome!');
          routeUser();
        }
      } catch (e) {
        console.error('Approval poll error:', e);
      }
    }, 5000);
  }
}

function stopApprovalWatcher() {
  if (_approvalChannel) {
    db.removeChannel(_approvalChannel);
    _approvalChannel = null;
  }
  if (_approvalPollInterval) {
    clearInterval(_approvalPollInterval);
    _approvalPollInterval = null;
  }
}

// ── REAL-TIME SURVEY STATUS WATCHER ──
let _surveyChannel = null;

function startSurveyStatusWatcher() {
  if (_surveyChannel) return;
  if (!currentUser || !currentProfile?.link_code) return;

  _surveyChannel = db
    .channel('survey-status-' + currentUser.id)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'census_surveys'
    }, (payload) => {
      const survey = payload.new;
      const isMine = survey.user_id === currentUser.id ||
                     survey.assigned_enumerator_id === currentUser.id ||
                     survey.enumerator_link_code === currentProfile.link_code;

      if (isMine && payload.old?.status !== survey.status) {
        const statusMsg = survey.status === 'approved' ? '✅ A survey was approved!' :
                          survey.status === 'rejected' ? '❌ A survey was rejected.' : '';
        if (statusMsg) showToast(statusMsg);

        // Auto-refresh records if currently viewing them
        const recordsScreen = document.getElementById('screen-records');
        if (recordsScreen && !recordsScreen.classList.contains('hidden')) {
          loadMyRecords();
        }
      }
    })
    .subscribe((status) => {
      console.log('Survey status channel status:', status);
    });
}

function stopSurveyStatusWatcher() {
  if (_surveyChannel) {
    db.removeChannel(_surveyChannel);
    _surveyChannel = null;
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
  toggleQ7Dependencies();
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

  if (input.id === 'q34' && value && !/^[6-9]\d{9}$/.test(value)) {
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

function isHiddenField(el) {
  return el?.closest('.hidden') !== null;
}

function validateStep(step, options = {}) {
  const container = document.querySelector(`.step[data-step="${step}"]`);
  if (!container) return true;

  // Skip steps 4-8 if house is locked
  if (step >= 4 && step <= 8 && document.getElementById('q7a_lock')?.checked) {
    return true;
  }

  // Skip steps 5-8 if sansthagat hai (institutional)
  if (step >= 5 && step <= 8 && document.getElementById('q7b_sansthagat')?.checked) {
    return true;
  }

  const requiredInputs = container.querySelectorAll('input[required]:not([type="radio"]), select[required]');
  const requiredRadioNames = [...new Set(
    Array.from(container.querySelectorAll('input[type="radio"][required]')).map(input => input.name)
  )];
  let valid = true;

  requiredInputs.forEach(input => {
    if (isHiddenField(input)) return;
    if (!validateInput(input, true)) valid = false;
  });

  requiredRadioNames.forEach(name => {
    const firstRadio = container.querySelector(`input[type="radio"][name="${escapeSelector(name)}"]`);
    if (isHiddenField(firstRadio)) return;
    if (!validateRadioGroup(name, container, true)) valid = false;
  });

  // Validate q7b_info if visible
  if (step === 3 && !document.getElementById('q7b-info-group')?.classList.contains('hidden')) {
    const q7cInput = document.getElementById('q7b_info');
    if (q7cInput && !validateInput(q7cInput, true)) valid = false;
  }

  if (!valid && options.focus !== false) focusFirstInvalid(container);

  return valid;
}

function getFirstInvalidSurveyStep() {
  for (let step = 1; step <= TOTAL_STEPS; step++) {
    if (step >= 4 && step <= 8 && document.getElementById('q7a_lock')?.checked) continue;
    if (step >= 5 && step <= 9 && document.getElementById('q7b_sansthagat')?.checked) continue;
    if (!validateStep(step, { focus: false })) return step;
  }
  return null;
}

function nextStep() {
  if (!validateStep(currentStep)) {
    showToast('Please complete the highlighted fields.');
    return;
  }
  if (currentStep === 3 && document.getElementById('q7a_lock')?.checked) {
    showWizardStep(9);
    return;
  }
  if (currentStep === 4 && document.getElementById('q7b_sansthagat')?.checked) {
    showWizardStep(9);
    return;
  }
  if (currentStep < TOTAL_STEPS) {
    showWizardStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep === 9 && document.getElementById('q7a_lock')?.checked) {
    showWizardStep(3);
    return;
  }
  if (currentStep === 9 && document.getElementById('q7b_sansthagat')?.checked) {
    showWizardStep(4);
    return;
  }
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

  const isEditingCitizenSurvey = _editingRecordId && _myRecordsCache.find(r => r.id === _editingRecordId && !r.user_id);

  let payload = {
    surveyor_email: currentUser.email,
    q1_line_number: parseInt(document.getElementById('q1').value, 10) || null,
    q2_building_number: document.getElementById('q2').value.trim(),
    q3_census_house_number: document.getElementById('q3').value.trim(),
    q4_floor_material: document.querySelector('input[name="q4"]:checked')?.value || '',
    q5_wall_material: document.querySelector('input[name="q5"]:checked')?.value || '',
    q6_roof_material: document.querySelector('input[name="q6"]:checked')?.value || '',
    q7_house_usage: document.querySelector('input[name="q7"]:checked')?.value || '',
    q7a_lock_hai: document.getElementById('q7a_lock')?.checked ? 'लॉक है' : '',
    q7b_sansthagat_hai: document.getElementById('q7b_sansthagat')?.checked ? 'संस्थागत है' : '',
    q7b_house_usage_detail: document.getElementById('q7b_info')?.value.trim() || '',
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

  // For new enumerator-submitted surveys, set the user_id and link_code
  if (!_editingRecordId) {
    payload.user_id = currentUser.id;
    payload.enumerator_link_code = currentProfile?.link_code || '';
  }

  // When editing a citizen survey, preserve ownership fields so it stays a citizen survey
  if (isEditingCitizenSurvey) {
    delete payload.user_id;
    delete payload.surveyor_email;
  }

  let error = null;
  try {
    const result = _editingRecordId
      ? await db.from('census_surveys').update(payload).eq('id', _editingRecordId)
      : await db.from('census_surveys').insert([payload]);
    if (result.error) error = result.error;
  } catch (err) {
    error = err;
  } finally {
    btn.disabled = false;
    btn.innerHTML = _editingRecordId ? '💾 Update Survey' : '✅ Submit Survey';
  }

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
  toggleQ7Dependencies();
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

// ── EDIT DETAILS MODAL ──
function openEditDetailsModal() {
  document.getElementById('ed-name').value = currentProfile?.name || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '';
  document.getElementById('ed-email').value = currentUser?.email || '';
  document.getElementById('ed-err').classList.add('hidden');
  document.getElementById('ed-success').classList.add('hidden');
  document.getElementById('modal-edit-details').style.display = 'flex';
}

function closeEditDetailsModal() {
  document.getElementById('modal-edit-details').style.display = 'none';
}

async function handleEditDetails(e) {
  e.preventDefault();
  const name = document.getElementById('ed-name').value.trim();
  const email = document.getElementById('ed-email').value.trim().toLowerCase();
  const err = document.getElementById('ed-err');
  const success = document.getElementById('ed-success');
  const btn = document.getElementById('btn-edit-details');

  err.classList.add('hidden');
  success.classList.add('hidden');

  if (!name) {
    showError(err, 'Name is required');
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(err, 'Enter a valid email address');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Saving…';

  let authEmailChanged = false;
  let authEmailError = null;

  try {
    // 1. Update profile first (most important — never skip)
    const { error: profileErr } = await db
      .from('surveyor_profiles')
      .update({ name, email })
      .eq('id', currentUser.id);
    if (profileErr) throw profileErr;

    // 2. Try auth email update separately so it can't block the profile update
    if (email !== currentUser.email) {
      try {
        const { error: authErr } = await db.auth.updateUser({ email });
        if (authErr) {
          authEmailError = authErr.message || 'Email update failed';
        } else {
          authEmailChanged = true;
          currentUser.email = email;
        }
      } catch (authEx) {
        authEmailError = authEx.message || 'Email update failed';
        console.warn('Auth email update error (non-blocking):', authEx);
      }
    }

    // 3. Update local state
    if (currentUser.user_metadata) currentUser.user_metadata.full_name = name;
    if (currentProfile) {
      currentProfile.name = name;
      currentProfile.email = email;
    }
    document.getElementById('surveyor-name').textContent = name || email;

    // 4. Show result
    if (authEmailError) {
      success.textContent = '✅ Name saved. ⚠️ Email update pending — check your new email inbox for a confirmation link from Supabase.';
      success.classList.remove('hidden');
    } else {
      success.textContent = '✅ Profile updated successfully!';
      success.classList.remove('hidden');
      setTimeout(closeEditDetailsModal, 2000);
    }
  } catch (ex) {
    console.error('Profile update error:', ex);
    showError(err, ex.message || 'Failed to save profile. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Changes';
  }
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

function generateShareLink() {
  if (!currentUser || !currentProfile?.link_code) return;
  const link = DEPLOY_BASE_URL + '/survey.html?ref=' + currentProfile.link_code;
  const input = document.getElementById('share-link');
  if (input) input.value = link;

  try {
    const qr = new QRious({
      element: document.getElementById('qr-canvas'),
      value: link,
      size: 240,
      level: 'M',
      background: 'white',
      foreground: 'black'
    });
  } catch (e) {
    console.error('QR generation failed:', e);
  }
}

function copyShareLink() {
  const input = document.getElementById('share-link');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('btn-copy-link');
    const oldText = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = oldText, 2000);
  });
}

async function loadMyRecords(from, to) {
  const body = document.getElementById('records-body');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">⏳ Loading…</div>';

  if (!db || !currentUser) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--rose-lt);">❌ Not logged in</div>';
    return;
  }

  try {
    const linkCode = currentProfile?.link_code || '';
    let query = db.from('census_surveys').select('*').or(`user_id.eq.${currentUser.id},assigned_enumerator_id.eq.${currentUser.id},enumerator_link_code.eq.${linkCode}`).order('created_at', { ascending: false });
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
      <th>#</th><th>Date</th><th>Source</th><th>Status</th><th>Line No.</th><th>Building</th><th>House</th>
      <th>Head Name</th><th>Persons</th><th>Mobile</th><th>Actions</th>
    </tr></thead><tbody>`;

    _myRecordsCache.forEach((r, i) => {
      const dt = new Date(r.created_at);
      const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const isCitizen = !r.user_id && r.assigned_enumerator_id === currentUser.id;
      const sourceBadge = isCitizen
        ? `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--cyan-sub);color:var(--cyan-lt);border:1px solid var(--cyan-border);padding:2px 8px;border-radius:var(--r-full);font-size:0.65rem;font-weight:700;">👤 Citizen</span>`
        : `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--indigo-sub);color:var(--indigo-lt);border:1px solid var(--indigo-border);padding:2px 8px;border-radius:var(--r-full);font-size:0.65rem;font-weight:700;">📝 Self</span>`;
      const statusBadge = r.status === 'pending'
        ? `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--amber-sub);color:var(--amber-lt);border:1px solid var(--amber-border);padding:2px 8px;border-radius:var(--r-full);font-size:0.65rem;font-weight:700;">⏳ Pending</span>`
        : r.status === 'rejected'
        ? `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--rose-sub);color:var(--rose-lt);border:1px solid var(--rose-border);padding:2px 8px;border-radius:var(--r-full);font-size:0.65rem;font-weight:700;">❌ Rejected</span>`
        : `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--emerald-sub);color:var(--emerald-lt);border:1px solid var(--emerald-border);padding:2px 8px;border-radius:var(--r-full);font-size:0.65rem;font-weight:700;">✅ Approved</span>`;
      let actionBtns = `<button class="action-btn" style="background:var(--indigo-sub);color:var(--indigo-lt);border:1px solid var(--indigo-border);padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;" onclick="openUserViewModal('${r.id}')">👁 View</button>`;
      actionBtns += `<button class="action-btn" style="background:var(--amber-sub);color:var(--amber-lt);border:1px solid var(--amber-border);padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;margin-left:4px;" onclick="startEditRecord('${r.id}')">✏️ Edit</button>`;
      if (isCitizen) {
        if (r.status === 'pending' || r.status === 'rejected') {
          actionBtns += `<button class="action-btn" style="background:linear-gradient(135deg,var(--emerald),#059669);color:#fff;padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;margin-left:4px;box-shadow:0 2px 8px rgba(16,185,129,0.3);" onclick="approveCitizenSurvey('${r.id}', this)">✅ Approve</button>`;
        }
        if (r.status === 'pending' || r.status === 'approved') {
          actionBtns += `<button class="action-btn" style="background:var(--rose-sub);color:var(--rose-lt);border:1px solid var(--rose-border);padding:5px 12px;font-size:0.75rem;border-radius:var(--r-full);cursor:pointer;margin-left:4px;" onclick="rejectCitizenSurvey('${r.id}', this)">❌ Reject</button>`;
        }
      }
      html += `<tr>
        <td>${i + 1}</td>
        <td><div style="font-weight:600;">${date}</div><div style="font-size:0.7rem;color:var(--t3);">${time}</div></td>
        <td>${sourceBadge}</td>
        <td>${statusBadge}</td>
        <td>${r.q1_line_number || '—'}</td>
        <td>${escapeHtml(r.q2_building_number || '—')}</td>
        <td>${escapeHtml(r.q3_census_house_number || '—')}</td>
        <td>${escapeHtml(r.q11_head_name || '—')}</td>
        <td>${r.q10_persons_count || '—'}</td>
        <td>${escapeHtml(r.q34_mobile_number || '—')}</td>
        <td>${actionBtns}</td>
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
  { key: 'q7a_lock_hai', label: 'Q7a. Lock hai (House Locked)' },
  { key: 'q7b_sansthagat_hai', label: 'Q7b. Sansthagat hai (Institutional)' },
  { key: 'q7b_house_usage_detail', label: 'Q7b. House Usage Detail' },
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
      stopSurveyStatusWatcher();
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
      const redirectTo = DEPLOY_BASE_URL + '/';
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
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Checking…';

    // Safety net: force re-enable button after 15s no matter what
    const safetyTimeout = setTimeout(() => {
      if (btn && btn.disabled) {
        btn.disabled = false;
        btn.textContent = '🔄 Check Status';
        console.warn('Check Status safety timeout fired — query may have hung');
      }
    }, 15000);

    try {
      const { data: rows, error } = await db
        .from('surveyor_profiles')
        .select('*')
        .eq('id', currentUser.id)
        .limit(1);

      if (error) {
        console.error('Check status query error:', error);
        throw error;
      }

      const row = rows?.[0];
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
      const desc = document.querySelector('#screen-wait .wait-desc');
      if (desc) {
        desc.style.color = 'var(--rose-lt)';
        desc.textContent = '⚠️ Could not check status. Please try again.';
        setTimeout(() => {
          desc.style.color = '';
          desc.textContent = 'Your account is created. An administrator needs to approve your profile before you can submit survey records.';
        }, 3000);
      }
    } finally {
      clearTimeout(safetyTimeout);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 Check Status';
      }
    }
  });

  // Force reset
  document.getElementById('form-force-reset')?.addEventListener('submit', handleForceReset);

  // Change pwd
  document.getElementById('form-change-pwd')?.addEventListener('submit', handleChangePwd);

  // Edit details
  document.getElementById('form-edit-details')?.addEventListener('submit', handleEditDetails);

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

  // Checkbox listeners for Q7a/Q7b
  const lockChk = document.getElementById('q7a_lock');
  const sanstChk = document.getElementById('q7b_sansthagat');
  if (lockChk) {
    lockChk.addEventListener('change', () => {
      if (lockChk.checked && sanstChk) {
        sanstChk.checked = false;
      }
      toggleQ7Dependencies();
    });
  }
  if (sanstChk) {
    sanstChk.addEventListener('change', () => {
      if (sanstChk.checked && lockChk) {
        lockChk.checked = false;
      }
      toggleQ7Dependencies();
    });
  }

  // Q7 radio change listener
  document.querySelectorAll('input[name="q7"]').forEach(radio => {
    radio.addEventListener('change', () => {
      toggleQ7Dependencies();
    });
  });
}

function toggleQ7Dependencies() {
  const q7Selected = document.querySelector('input[name="q7"]:checked');
  const q7Value = q7Selected?.value;
  const lockChk = document.getElementById('q7a_lock');
  const sanstChk = document.getElementById('q7b_sansthagat');
  const q7cGroup = document.getElementById('q7b-info-group');
  const q7cInput = document.getElementById('q7b_info');
  const q8Group = document.getElementById('q8-group');
  const q33Group = document.getElementById('q33-group');
  const q34Group = document.getElementById('q34-group');

  // Disable/enable checkboxes based on Q7 selection
  if (lockChk) {
    const lockCard = lockChk.closest('.checkbox-card');
    if (q7Value && q7Value !== 'आवास' && q7Value !== 'आवास-सह-अन्य उपयोग') {
      lockChk.checked = false;
      lockCard?.classList.add('disabled');
    } else {
      lockCard?.classList.remove('disabled');
    }
  }
  if (sanstChk) {
    const sanstCard = sanstChk.closest('.checkbox-card');
    if (q7Value === 'आवास') {
      sanstChk.checked = false;
      sanstCard?.classList.add('disabled');
    } else {
      sanstCard?.classList.remove('disabled');
    }
  }

  // Show/hide Q7c based on Q7 selection
  if (q7cGroup && q7cInput) {
    if (q7Value && q7Value !== 'आवास') {
      q7cGroup.classList.remove('hidden');
      q7cInput.required = true;
    } else {
      q7cGroup.classList.add('hidden');
      q7cInput.required = false;
      q7cInput.value = '';
      clearFieldError(q7cInput);
    }
  }

  // Show/hide Q8 based on lock hai
  if (q8Group) {
    if (lockChk?.checked) {
      q8Group.classList.add('hidden');
      // Clear Q8 selection
      document.querySelectorAll('input[name="q8"]').forEach(r => {
        r.checked = false;
        clearFieldError(r);
      });
    } else {
      q8Group.classList.remove('hidden');
    }
  }

  // Show/hide Q12-Q13 based on sansthagat hai
  const q12Group = document.getElementById('q12-group');
  const q13Group = document.getElementById('q13-group');
  if (q12Group) {
    if (sanstChk?.checked) {
      q12Group.classList.add('hidden');
      document.querySelectorAll('input[name="q12"]').forEach(r => {
        r.checked = false;
        clearFieldError(r);
      });
    } else {
      q12Group.classList.remove('hidden');
    }
  }
  if (q13Group) {
    if (sanstChk?.checked) {
      q13Group.classList.add('hidden');
      document.querySelectorAll('input[name="q13"]').forEach(r => {
        r.checked = false;
        clearFieldError(r);
      });
    } else {
      q13Group.classList.remove('hidden');
    }
  }

  // Show/hide Q33 based on lock hai or sansthagat hai
  if (q33Group) {
    if (lockChk?.checked || sanstChk?.checked) {
      q33Group.classList.add('hidden');
      document.querySelectorAll('input[name="q33"]').forEach(r => {
        r.checked = false;
        clearFieldError(r);
      });
    } else {
      q33Group.classList.remove('hidden');
    }
  }

  // Show/hide Q34 based on sansthagat hai
  if (q34Group) {
    if (sanstChk?.checked) {
      q34Group.classList.add('hidden');
      document.getElementById('q34').value = '';
      clearFieldError(document.getElementById('q34'));
    } else {
      q34Group.classList.remove('hidden');
    }
  }

  // Show/hide step 9 card/header based on sansthagat hai or lock hai
  const step9Card = document.getElementById('step9-card');
  const step9Header = step9Card?.querySelector('.card-header');
  if (step9Header) {
    if (sanstChk?.checked || lockChk?.checked) {
      step9Header.classList.add('hidden');
    } else {
      step9Header.classList.remove('hidden');
    }
  }
  if (step9Card) {
    if (sanstChk?.checked) {
      step9Card.classList.add('hidden');
    } else {
      step9Card.classList.remove('hidden');
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  VIEW REPORT MODAL (User)
// ═══════════════════════════════════════════════════════════

function openUserViewModal(recordId) {
  const record = _myRecordsCache.find(r => r.id === recordId);
  if (!record) return;

  const dt = new Date(record.created_at);
  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isCitizen = !record.user_id && record.assigned_enumerator_id;

  let html = `<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--bd);">
    <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Submitted</div>
    <div style="font-weight:700;color:var(--t1);">${dateStr}</div>
  </div>`;

  if (isCitizen) {
    html += `<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:16px;">`;
    html += `<div style="display:flex;gap:12px;padding:10px 12px;background:var(--cyan-sub);border-radius:var(--r-md);border:1px solid var(--cyan-border);">
      <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;min-width:140px;flex-shrink:0;padding-top:2px;">Source</div>
      <div style="font-size:0.88rem;font-weight:600;color:var(--t1);word-break:break-word;">👤 Citizen Self Survey</div>
    </div>`;
    if (record.citizen_name) {
      html += `<div style="display:flex;gap:12px;padding:10px 12px;background:var(--bg-raised);border-radius:var(--r-md);border:1px solid var(--bd);">
        <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;min-width:140px;flex-shrink:0;padding-top:2px;">Citizen Name</div>
        <div style="font-size:0.88rem;font-weight:600;color:var(--t1);word-break:break-word;">${escapeHtml(record.citizen_name)}</div>
      </div>`;
    }
    if (record.citizen_mobile) {
      html += `<div style="display:flex;gap:12px;padding:10px 12px;background:var(--bg-raised);border-radius:var(--r-md);border:1px solid var(--bd);">
        <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;min-width:140px;flex-shrink:0;padding-top:2px;">Citizen Mobile</div>
        <div style="font-size:0.88rem;font-weight:600;color:var(--t1);word-break:break-word;">${escapeHtml(record.citizen_mobile)}</div>
      </div>`;
    }
    html += `<div style="display:flex;gap:12px;padding:10px 12px;background:var(--bg-raised);border-radius:var(--r-md);border:1px solid var(--bd);">
      <div style="font-size:0.65rem;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;min-width:140px;flex-shrink:0;padding-top:2px;">Status</div>
      <div style="font-size:0.88rem;font-weight:600;color:var(--t1);word-break:break-word;">${escapeHtml(record.status || 'approved')}</div>
    </div>`;
    html += '</div>';
  }

  html += '<div style="display:grid;grid-template-columns:1fr;gap:10px;">';
  QUESTION_LABELS.forEach(q => {
    const displayVal = getDisplayValue(record, q.key);
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
    q7b_info: 'q7b_house_usage_detail',
  };
  Object.entries(textMap).forEach(([id, col]) => {
    const el = document.getElementById(id);
    if (el) el.value = record[col] ?? '';
  });

  // Load checkboxes
  const lockChk = document.getElementById('q7a_lock');
  if (lockChk) lockChk.checked = !!record.q7a_lock_hai;
  const sanstChk = document.getElementById('q7b_sansthagat');
  if (sanstChk) sanstChk.checked = !!record.q7b_sansthagat_hai;
  toggleQ7Dependencies();

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
  toggleQ7Dependencies();
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('hidden', i !== 0));
  currentStep = 1;
  updateProgress();
  document.getElementById('btn-submit').innerHTML = '✅ Submit Survey';
  showToast('❌ Edit cancelled.');
}

// ── ENUMERATOR APPROVE / REJECT CITIZEN SURVEYS ──
async function approveCitizenSurvey(id, btn) {
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    const { error } = await db.from('census_surveys').update({ status: 'approved' }).eq('id', id);
    if (error) throw error;
    showToast('✅ Survey approved successfully!');
    loadMyRecords();
  } catch (e) {
    showToast('❌ Error: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function rejectCitizenSurvey(id, btn) {
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    const { error } = await db.from('census_surveys').update({ status: 'rejected' }).eq('id', id);
    if (error) throw error;
    showToast('❌ Survey rejected.');
    loadMyRecords();
  } catch (e) {
    showToast('❌ Error: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
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
      ...QUESTION_LABELS.map(q => getDisplayValue(r, q.key))
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
      const val = getDisplayValue(record, q.key);
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

// Helper: returns display value for exports, showing "Not applicable" for skipped fields
function getDisplayValue(record, key) {
  const val = record[key];
  if (val !== null && val !== undefined && val !== '') return String(val);
  // If sansthagat hai is checked, Q12-Q34 are not applicable
  const sansthagatKeys = ['q12_gender','q13_category','q14_ownership','q15_rooms_count','q16_married_couples','q17_water_source','q18_water_availability','q19_light_source','q20_toilet_facility','q21_toilet_type','q22_drainage','q23_bathing_facility','q24_kitchen_gas','q25_cooking_fuel','q26_radio','q27_tv','q28_internet','q29_laptop','q30_phone','q31_cycle_scooter','q32_car','q33_main_grain','q34_mobile_number'];
  if (record.q7b_sansthagat_hai && sansthagatKeys.includes(key)) {
    return 'लागू नहीं / Not applicable';
  }
  return '—';
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
