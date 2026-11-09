// Shared by the "outside" websites: record the visit so the game can react, and render relative dates.
(function () {
  const page = document.body.dataset.page;
  const KEY = 'mi-arg-visits';
  function mark(id) {
    try { const v = JSON.parse(localStorage.getItem(KEY)) || {}; v[id] = Date.now(); localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  }
  if (page) mark(page);
  for (const a of document.querySelectorAll('[data-visit]')) a.addEventListener('click', () => mark(a.dataset.visit));
  // Links that go nowhere are pages the phone never saved. Say so instead of jumping to the top.
  let toastEl = null, toastTimer = 0;
  window.__toast = text => { if (!toastEl) { toastEl = document.createElement('div'); toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#222;color:#fff;font-size:14px;padding:10px 16px;border-radius:999px;z-index:99;opacity:0;transition:opacity .3s;pointer-events:none;max-width:90%;text-align:center'; document.body.append(toastEl); } toastEl.textContent = text; toastEl.style.opacity = '1'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600); };
  for (const a of document.querySelectorAll('a[href="#"]')) a.addEventListener('click', e => { e.preventDefault(); window.__toast('このページは保存されていません（圏外のため開けません）'); });
  if (location.hash) { const el = document.querySelector(location.hash); if (el?.dataset.visit) mark(el.dataset.visit); }

  // The story is set on 2030-11-05 (Tue). The clock is the game's: real time at night, else 21:40 plus play time.
  const YEAR = 2030;
  const real = new Date();
  let startAt = 0; try { startAt = Number(localStorage.getItem('mi-start-at')) || 0; } catch {}
  let mode = null; try { mode = localStorage.getItem('mi-clock-mode'); } catch {}
  const h = real.getHours();
  if (!mode) mode = (h >= 19 || h < 5) ? 'real' : 'virtual';
  let now;
  if (mode === 'real') now = new Date(real); else { const base = startAt || real.getTime(); now = new Date(base); now.setHours(21, 40, 0, 0); now = new Date(now.getTime() + Math.min(real.getTime() - base, 6 * 3600 * 1000)); }
  now.setFullYear(YEAR, 10, now.getHours() < 5 ? 6 : 5);
  const gameNow = new Date(now);
  let world = {};
  try { world = JSON.parse(localStorage.getItem('mi-arg-world')) || {}; } catch {}
  // No signal yet: every page is what the phone loaded in the evening, so the clock on them stops at 18:50.
  // Inside the game the phone's own bar says saved/latest, so the page does not add a second band. Opened on its own, every page (SNS too) says it.
  const inGame = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const offline = !world.airOn && !inGame;
  // The pages were saved at 18:50. Nothing that happened tonight after that can be on them until the signal is back.
  if (!world.airOn) world = { ...world, reported: false, escaped: false, selfReported: false, released: false, screenStopped: false, reportedAt: null };
  if (!world.airOn) { now = new Date(gameNow); now.setHours(18, 50, 0, 0); now.setFullYear(YEAR, 10, 5); }
  const pad = n => String(n).padStart(2, '0');
  const week = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const fmtJa = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${week[d.getDay()]}）`;
  for (const el of document.querySelectorAll('[data-today-ja]')) el.textContent = fmtJa(now);
  for (const el of document.querySelectorAll('[data-days-ago]')) {
    const d = new Date(now); d.setDate(d.getDate() - Number(el.dataset.daysAgo));
    el.textContent = el.dataset.withTime ? `${fmt(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : fmt(d);
  }
  for (const el of document.querySelectorAll('[data-minutes-ago]')) {
    const m = Number(el.dataset.minutesAgo);
    el.textContent = m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`;
  }
  for (const el of document.querySelectorAll('[data-now]')) el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(YEAR + Number(el.dataset.year || 0));

  for (const el of document.querySelectorAll('[data-world]')) { const v = world[el.dataset.world]; if (v) el.textContent = v; }
  for (const el of document.querySelectorAll('[data-world-time]')) { const v = world[el.dataset.worldTime]; if (v) el.textContent = `${fmt(gameNow)} ${v}`; }
  if (offline) { const band = document.createElement('div'); band.className = 'offline-band'; band.textContent = 'オフライン表示'; band.style.cssText = 'background:#f1f3f4;color:#555;font-size:14px;padding:8px 16px;text-align:center;border-bottom:1px solid #dcdfe3'; document.body.prepend(band); }
  window.__now = now; window.__gameNow = gameNow;
  for (const el of document.querySelectorAll('[data-player]')) el.textContent = world.name || el.dataset.player || 'あなた';
  for (const el of document.querySelectorAll('[data-if-player]')) el.hidden = !world.name;
  // An element may carry both: shown only when every data-when key is set and no data-unless key is.
  for (const el of document.querySelectorAll('[data-when],[data-unless]')) {
    const when = (el.dataset.when || '').split(' ').filter(Boolean), unless = (el.dataset.unless || '').split(' ').filter(Boolean);
    el.hidden = !when.every(k => world[k]) || unless.some(k => world[k]);
  }
  window.__world = world;
  // After the signal is back: what tonight added to a page gets a small NEW, so the saved 18:50 version and the latest can be told apart.
  // Runs after the page's own scripts (data-when-any on the news page).
  const TONIGHT = ['reported', 'selfReported', 'escaped', 'released', 'releasedClock', 'reportedClock', 'selfReportedClock', 'momStayAt', 'momFooled', 'scammed', 'screenStopped', 'paused', 'proxyRevoked'];
  if (world.airOn) setTimeout(() => {
    const keysOf = el => [...(el.dataset.when || '').split(' '), ...(el.dataset.whenAny || '').split(' ')].filter(Boolean);
    for (const el of document.querySelectorAll('[data-when],[data-when-any]')) {
      if (el.hidden || el.closest('[hidden]') || !keysOf(el).some(k => TONIGHT.includes(k))) continue;
      let up = el.parentElement, nested = false;
      while (up) { if ((up.dataset.when || up.dataset.whenAny) && keysOf(up).some(k => TONIGHT.includes(k))) { nested = true; break; } up = up.parentElement; }
      if (nested || el.querySelector(':scope > .new-tag')) continue;
      const tag = document.createElement('span'); tag.className = 'new-tag'; tag.textContent = 'NEW';
      tag.style.cssText = 'display:inline-block;font-size:14px;font-weight:700;line-height:1;padding:2px 5px;margin:0 6px 0 0;border-radius:3px;background:#d64545;color:#fff;vertical-align:2px;letter-spacing:.04em';
      el.prepend(tag);
    }
  }, 0);
})();
