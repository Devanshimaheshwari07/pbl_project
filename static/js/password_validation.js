(function () {
  'use strict';

  function validatePasswordStrength(password) {
    const passwordStrength = document.getElementById('password-strength');
    const pattern = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordStrength) return;
    if (password.match(pattern)) {
      passwordStrength.textContent = 'Password is strong.';
      passwordStrength.style.color = 'green';
    } else {
      passwordStrength.textContent = 'Password is weak. It should include at least one uppercase letter, one lowercase letter, one number, and one special character.';
      passwordStrength.style.color = 'red';
    }
  }

  function attachPasswordValidator(inputId = 'password') {
    const pwd = document.getElementById(inputId);
    if (!pwd) return;
    validatePasswordStrength(pwd.value || '');
    pwd.addEventListener('input', function (e) {
      validatePasswordStrength(e.target.value);
    });
  }

  async function verifyProfile() {
    const resp = await fetch('/api/check_profile');
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => ({}));
    return Boolean(data.profile_exists);
  }

  function getLocation(timeout = 5000) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      var done = false;
      var timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeout);
      navigator.geolocation.getCurrentPosition(function (pos) {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      }, function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(null);
      }, { timeout: timeout });
    });
  }

  async function sendSosRequest(payload) {
    const resp = await fetch('/api/sos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await resp.json().catch(() => ({}));
    return { ok: resp.ok, body: j };
  }

  function attachSosHandler(buttonId = 'sos-btn') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      const hasProfile = await verifyProfile();
      if (!hasProfile) {
        alert("Please complete your medical profile before using Emergency SOS.");
        btn.disabled = false;
        return;
      }
      const loc = await getLocation(5000);
      const payload = loc ? { latitude: loc.latitude, longitude: loc.longitude } : {};
      try {
        const result = await sendSosRequest(payload);
        if (result.ok) {
          alert('SOS Alert Sent! Location shared.');
        } else {
          alert('SOS error: ' + (result.body.error || result.body.message || 'unknown'));
        }
      } catch (err) {
        alert('Network error sending SOS: ' + (err && err.message ? err.message : String(err)));
      } finally {
        setTimeout(() => { btn.disabled = false; }, 3000);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    attachPasswordValidator('password');
    attachSosHandler('sos-btn');
  });

  window.ResQmed = {
    validatePasswordStrength,
    attachPasswordValidator,
    attachSosHandler
  };
})();
