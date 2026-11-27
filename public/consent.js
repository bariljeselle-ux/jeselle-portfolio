/* Data privacy consent checkbox (Data Privacy Act of 2012, RA 10173).
   Adds a required "I agree" box to every form that collects personal details,
   blocks sending until it's ticked, and sends the answer + date with the form
   so it shows in the CRM and in the email copy. */
(function () {
  var FORMS = ['bk-form', 'inq-form', 'brief', 'pay-form', 'rf', 'pf'];
  var MSG = 'Please tick the box to agree to the Privacy Policy before sending.';
  var css = '.pconsent{display:flex;gap:12px;align-items:flex-start;margin:16px 0 4px;padding:14px 16px;background:#F7F3EE;border:1px solid #E2D9CF;border-radius:8px;cursor:pointer;text-align:left;font:300 14.5px/1.6 Jost,system-ui,sans-serif;color:#4A413B}' +
    '.pconsent input{width:20px;height:20px;min-width:20px;margin:2px 0 0;accent-color:#7A4E3A;cursor:pointer}' +
    '.pconsent b{font-weight:500;color:#231E1B}.pconsent a{color:#7A4E3A;font-weight:500;text-underline-offset:3px}' +
    '.pconsent.bad{border-color:#B4412E;background:#FBEFEC}.pconsent .perr{display:block;margin-top:4px;color:#8A2E1E;font-weight:400}';
  try { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); } catch (e) {}

  function box(form) {
    var id = 'pc-' + form.id;
    var lab = document.createElement('label');
    lab.className = 'pconsent';
    lab.innerHTML = '<input type="checkbox" name="privacy_consent" value="Yes, agreed to the Privacy Policy" id="' + id + '">' +
      '<span>I agree that <b>jeselle.va</b> may use the details I share here to reply to me and provide its services, as explained in the ' +
      '<a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. <b>Required</b>' +
      '<span class="perr" role="alert" hidden></span></span>';
    return lab;
  }
  function place(form, lab) {
    var steps = form.querySelectorAll('.tfq');
    if (steps.length) { // step-by-step forms: put it on the last question
      var last = steps[steps.length - 1], nav = last.querySelector('.tfnav');
      if (nav) last.insertBefore(lab, nav); else last.appendChild(lab);
      return;
    }
    var btn = form.querySelector('[type=submit]');
    var el = btn;
    while (el && el.parentElement && el.parentElement !== form) el = el.parentElement;
    if (el && el.parentElement === form) form.insertBefore(lab, el); else form.appendChild(lab);
  }
  function init() {
    FORMS.forEach(function (fid) {
      var form = document.getElementById(fid);
      if (!form || form.querySelector('.pconsent')) return;
      var lab = box(form); place(form, lab);
      var cb = lab.querySelector('input'), err = lab.querySelector('.perr');
      var at = document.createElement('input'); at.type = 'hidden'; at.name = 'privacy_consent_date'; form.appendChild(at);
      cb.addEventListener('change', function () { if (cb.checked) { lab.classList.remove('bad'); err.hidden = true; } });
      form._consentOk = function () {
        if (cb.checked) { at.value = new Date().toISOString(); return true; }
        lab.classList.add('bad'); err.hidden = false; err.textContent = MSG;
        // make sure the box is visible (step-by-step forms)
        var step = lab.closest('.tfq'); if (step && step.hidden && typeof window.tfGo === 'function') window.tfGo(step);
        try { lab.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        cb.focus({ preventScroll: true });
        return false;
      };
    });
  }
  // Runs before the page's own submit code, so nothing is sent without consent.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && typeof f._consentOk === 'function' && !f._consentOk()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
