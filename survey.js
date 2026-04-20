// ═══════════════════════════════════════════════════════════
//  Citizen Self Survey — Anonymous submission with enumerator ref
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://dvmhgzsxdidrvztmfrcq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWhnenN4ZGlkcnZ6dG1mcmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTQ4MTAsImV4cCI6MjA5MjA5MDgxMH0.Z2CgTRQOEHS9GtQLcbW6bNjnGDYhCg-TwApRVu3IoLo';

let db = null;
let enumeratorId = null;
let enumeratorName = null;
let currentStep = 1;
const TOTAL_STEPS = 9;

const ST = {
  loading: document.getElementById('screen-loading'),
  error: document.getElementById('screen-error'),
  main: document.getElementById('screen-main'),
  pending: document.getElementById('screen-pending')
};

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  try {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('Supabase init failed:', e);
    showToast('❌ Failed to connect to database');
    showScreen('error');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  enumeratorId = params.get('ref');

  if (!enumeratorId) {
    showScreen('error');
    return;
  }

  validateEnumerator().then(valid => {
    if (!valid) {
      showScreen('error');
      return;
    }
    setupEventListeners();
    showScreen('main');
  });
});

async function validateEnumerator() {
  try {
    const { data, error } = await db
      .from('surveyor_profiles')
      .select('name, email, approved')
      .eq('id', enumeratorId)
      .single();

    if (error || !data || !data.approved) {
      console.error('Enumerator validation failed:', error);
      return false;
    }

    enumeratorName = data.name || data.email;
    const badge = document.getElementById('enum-badge');
    if (badge) badge.textContent = `👤 Enumerator: ${enumeratorName}`;
    return true;
  } catch (e) {
    console.error('validateEnumerator error:', e);
    return false;
  }
}

function showScreen(key) {
  Object.keys(ST).forEach(k => ST[k]?.classList.add('hidden'));
  if (ST[key]) ST[key].classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ── THEME ──
document.querySelectorAll('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('census-theme', next);
    document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = next === 'dark' ? '☀️' : '🌙');
  });
});

// ── WIZARD ──
function updateProgress() {
  const pct = (currentStep / TOTAL_STEPS) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
  document.getElementById('btn-prev').classList.toggle('hidden', currentStep === 1);
  document.getElementById('btn-next').classList.toggle('hidden', currentStep === TOTAL_STEPS);
  document.getElementById('btn-submit').classList.toggle('hidden', currentStep !== TOTAL_STEPS);
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
  if (input.id === 'citizen_mobile' && value && !/^[6-9]\d{9}$/.test(value)) {
    return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
  }
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
  if (input.minLength > 0 && value.length < input.minLength) return `Enter at least ${input.minLength} characters.`;
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
  if (step >= 4 && step <= 8 && document.getElementById('q7a_lock')?.checked) return true;
  if (step >= 5 && step <= 8 && document.getElementById('q7b_sansthagat')?.checked) return true;

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

// ── FORM SUBMIT ──
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

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Submitting…';

  const payload = {
    assigned_enumerator_id: enumeratorId,
    surveyor_email: enumeratorName,
    status: 'pending',
    citizen_name: document.getElementById('citizen_name').value.trim(),
    citizen_mobile: document.getElementById('citizen_mobile').value.trim(),
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

  let error = null;
  try {
    const dbPromise = db.from('census_surveys').insert([payload]);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000)
    );
    const result = await Promise.race([dbPromise, timeoutPromise]);
    if (result.error) error = result.error;
  } catch (err) {
    error = err;
  }

  btn.disabled = false;
  btn.innerHTML = '✅ Submit Survey';

  if (error) {
    showToast('❌ Error: ' + (error.message || 'Unknown error'));
    console.error('Submit error:', error);
  } else {
    showScreen('pending');
  }
}

// ── EVENT LISTENERS ──
function setupEventListeners() {
  const surveyForm = document.getElementById('survey-form');
  surveyForm.setAttribute('novalidate', 'novalidate');
  surveyForm.addEventListener('submit', handleSubmit);
  setupSurveyValidation();

  document.querySelectorAll('#survey-form .form-input, #survey-form .form-select').forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentStep < TOTAL_STEPS) {
          nextStep();
        } else {
          surveyForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    });
  });
}

function setupSurveyValidation() {
  document.querySelectorAll('#survey-form .form-input, #survey-form .form-select').forEach(input => {
    input.addEventListener('input', () => {
      if (input.id === 'q34' || input.id === 'citizen_mobile') input.value = input.value.replace(/\D/g, '').slice(0, 10);
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

  const lockChk = document.getElementById('q7a_lock');
  const sanstChk = document.getElementById('q7b_sansthagat');
  if (lockChk) {
    lockChk.addEventListener('change', () => {
      if (lockChk.checked && sanstChk) sanstChk.checked = false;
      toggleQ7Dependencies();
    });
  }
  if (sanstChk) {
    sanstChk.addEventListener('change', () => {
      if (sanstChk.checked && lockChk) lockChk.checked = false;
      toggleQ7Dependencies();
    });
  }

  document.querySelectorAll('input[name="q7"]').forEach(radio => {
    radio.addEventListener('change', () => toggleQ7Dependencies());
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

  if (q8Group) {
    if (lockChk?.checked) {
      q8Group.classList.add('hidden');
      document.querySelectorAll('input[name="q8"]').forEach(r => {
        r.checked = false;
        clearFieldError(r);
      });
    } else {
      q8Group.classList.remove('hidden');
    }
  }

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

  if (q34Group) {
    if (sanstChk?.checked) {
      q34Group.classList.add('hidden');
      document.getElementById('q34').value = '';
      clearFieldError(document.getElementById('q34'));
    } else {
      q34Group.classList.remove('hidden');
    }
  }

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

function showToast(msg) {
  const t = document.getElementById('global-toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
