// Shared behaviour for JB's sample websites: request list, booking slots in the visitor's time zone,
// a sample inquiry form (nothing is sent) and the owner dashboard preview.
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const body = document.body, KEY = 'demo-picks-' + (body.dataset.site || 'x'), CUR = body.dataset.cur || '₱';
  const money = (n) => CUR + Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let picks = [];
  try { picks = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { picks = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) {} };

  // ---- Request list ----
  function render() {
    $$('[data-add]').forEach((b) => {
      const on = picks.some((p) => p.id === b.dataset.add);
      b.setAttribute('aria-pressed', on);
      b.textContent = on ? (b.dataset.on || 'Added ✓ (tap to remove)') : (b.dataset.off || b.dataset.offLabel || 'Add to my request');
    });
    const list = $('#picklist'), tot = $('#picktotal'), count = $('#pickcount');
    if (count) { count.textContent = picks.length; count.hidden = !picks.length; }
    if (!list) return;
    list.innerHTML = picks.length
      ? picks.map((p) => `<li><span>${esc(p.name)}</span><b>${money(p.price)}</b><button type="button" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></li>`).join('')
      : `<li class="empty">${esc(list.dataset.empty || 'Nothing added yet.')}</li>`;
    if (tot) tot.textContent = picks.length ? money(picks.reduce((a, p) => a + p.price, 0)) : money(0);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-add]');
    if (a) {
      const id = a.dataset.add, i = picks.findIndex((p) => p.id === id);
      if (i >= 0) picks.splice(i, 1); else picks.push({ id, name: a.dataset.name, price: Number(a.dataset.price) || 0 });
      save(); render();
      const tray = $('#tray'); if (tray && i < 0) { tray.classList.remove('bump'); void tray.offsetWidth; tray.classList.add('bump'); }
      return;
    }
    const r = e.target.closest('[data-rm]');
    if (r) { picks = picks.filter((p) => p.id !== r.dataset.rm); save(); render(); }
  });
  window.demoAddPick = (p) => { picks = picks.filter((x) => x.id !== p.id); picks.push(p); save(); render(); };

  // ---- Booking slots shown in the visitor's own time ----
  const slotBox = $('#slots');
  let chosen = null;
  if (slotBox) {
    const tz = body.dataset.tz || 'Asia/Manila', hours = (slotBox.dataset.hours || '10,11,14,15').split(',').map(Number);
    const offH = Number(body.dataset.utc || 8); // owner's UTC offset (no daylight saving in Manila or Brisbane)
    const you = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const days = []; const now = new Date();
    for (let d = 1; days.length < 5 && d < 14; d++) {
      const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
      const wd = base.getUTCDay(); if ((slotBox.dataset.closed || '0').split(',').includes(String(wd))) continue;
      days.push(base);
    }
    const fDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fYou = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
    const fOwn = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const same = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(now) === new Intl.DateTimeFormat('en-US', { hour: 'numeric' }).format(now);
    const note = $('#tznote'); if (note) note.textContent = same ? 'Times are shown in your local time.' : `Times are shown in your time (${you.replace(/_/g, ' ')}). The owner's time is in small print.`;
    slotBox.innerHTML = days.map((d, di) => {
      const btns = hours.map((h) => {
        const t = new Date(d.getTime() + (h - offH) * 3600000);
        return `<button type="button" class="slot" data-t="${t.toISOString()}" aria-pressed="false">${fYou.format(t)}${same ? '' : `<small>${fOwn.format(t)} theirs</small>`}</button>`;
      }).join('');
      return `<div class="sday"><p>${fDay.format(new Date(d.getTime() + 12 * 3600000))}</p><div>${btns}</div></div>`;
    }).join('');
    slotBox.addEventListener('click', (e) => {
      const b = e.target.closest('.slot'); if (!b) return;
      $$('.slot', slotBox).forEach((x) => x.setAttribute('aria-pressed', x === b));
      chosen = new Date(b.dataset.t);
      const out = $('#slotchosen');
      if (out) out.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(chosen) + ' (your time)';
    });
  }

  // ---- Sample form: shows what the owner would receive, sends nothing ----
  $$('form[data-demo]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    const done = $(f.dataset.demo);
    if (!done) return;
    const rows = [];
    if (d.name) rows.push(['Name', d.name]);
    if (chosen) rows.push(['Booked for', $('#slotchosen')?.textContent || chosen.toString()]);
    if (picks.length) rows.push(['Request', picks.map((p) => p.name).join(', ') + ' · ' + money(picks.reduce((a, p) => a + p.price, 0))]);
    Object.entries(d).forEach(([k, v]) => { if (v && !['name', 'email'].includes(k)) rows.push([k.replace(/_/g, ' '), v]); });
    $('.donerows', done).innerHTML = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
    f.hidden = true; done.hidden = false; done.focus();
  }));
  $$('[data-again]').forEach((b) => b.addEventListener('click', () => {
    const done = b.closest('[tabindex]'); const f = $(`form[data-demo="#${done.id}"]`);
    done.hidden = true; f.hidden = false; f.reset();
  }));

  // ---- Owner dashboard preview tabs ----
  $$('[role="tablist"]').forEach((tl) => tl.addEventListener('click', (e) => {
    const t = e.target.closest('[role="tab"]'); if (!t) return;
    $$('[role="tab"]', tl).forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); $('#' + x.getAttribute('aria-controls')).hidden = !on; });
  }));

  // Sticky header shadow
  const hd = $('header.top'); if (hd) addEventListener('scroll', () => hd.classList.toggle('scrolled', scrollY > 8), { passive: true });
  render();
})();
