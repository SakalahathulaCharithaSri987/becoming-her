/* ==========================================================
   Becoming Her — script.js
   Vanilla JavaScript. All data is kept in the browser's
   localStorage under ONE key (see STORAGE_KEY).

   Data shape:
   {
     app: "becoming-her", version: 1,
     settings: { boundary, schedules[], skincare{am[],pm[]}, hair{0..6} },
     days: { "YYYY-MM-DD": { study, sleep, skincare, hair, exercise, meals, reading, steps } }
   }
   The date keys are PERSONAL-DAY dates (see personalToday()).
   ========================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. CONSTANTS
     --------------------------------------------------------- */
  var STORAGE_KEY = 'becomingHer.data.v1';
  var APP_ID = 'becoming-her';
  var DATA_VERSION = 1;

  // Daily targets (minutes, steps, meals)
  var TARGET = { study: 180, sleep: 360, reading: 30, steps: 10000, meals: 3 };

  var HABITS = [
    { id: 'study', name: 'Career Switch Study', target: '3 hours' },
    { id: 'sleep', name: 'Sleep', target: '6 hours' },
    { id: 'skincare', name: 'Skincare', target: 'After waking + before sleep' },
    { id: 'hair', name: 'Hair Care', target: 'Per your weekly schedule' },
    { id: 'exercise', name: 'Exercise', target: 'Planned workout' },
    { id: 'meals', name: 'Three Meals', target: '3 meals' },
    { id: 'reading', name: 'Book Reading', target: '30 minutes' },
    { id: 'steps', name: 'Walking', target: '10,000 steps' }
  ];

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  /* ---------------------------------------------------------
     2. SMALL HELPERS
     --------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function has(s) { return typeof s === 'string' && s.trim() !== ''; }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
  function uid() { return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }

  // Whole non-negative number, capped at "max"
  function num(v, max) {
    var n = Math.floor(Number(v));
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, max);
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 2000) : ''; }
  function dtStr(v) { return typeof v === 'string' && DT_RE.test(v) ? v : ''; }

  /* ---------------------------------------------------------
     3. DATE HELPERS
     We work with "YYYY-MM-DD" strings. dateOf() builds a Date at
     12:00 noon local time so daylight-saving shifts never change the day.
     --------------------------------------------------------- */
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dateOf(key) {
    var p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
  }
  function isRealDate(key) { return DATE_RE.test(key) && keyOf(dateOf(key)) === key; }
  function addDays(key, n) { var d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); }
  function minutesOfDay(t) { var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function monthKeys(year, m0) {
    var count = new Date(year, m0 + 1, 0).getDate();
    var keys = [];
    for (var d = 1; d <= count; d++) keys.push(year + '-' + pad(m0 + 1) + '-' + pad(d));
    return keys;
  }

  function fmtTime(t) {
    var p = t.split(':').map(Number);
    var h = p[0], suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + pad(p[1]) + ' ' + suffix;
  }
  function fmtDateLong(key) {
    return dateOf(key).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtDateShort(key) {
    return dateOf(key).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  /* ---------------------------------------------------------
     4. DEFAULT DATA, CLEANING & STORAGE
     --------------------------------------------------------- */
  function defaultSettings() {
    var hair = {};
    for (var i = 0; i < 7; i++) hair[i] = { wash: false, condition: false, other: '' };
    return {
      boundary: '06:00', // personal-day boundary (6:00 AM by default)
      schedules: [
        // November 2026: night shift, every day
        { id: 'nov-2026-night', label: 'Night shift', from: '2026-11-01', to: '2026-11-30',
          days: [0, 1, 2, 3, 4, 5, 6], start: '16:30', end: '02:30' },
        // December 2026 onward: Monday–Friday, 12 PM–11 PM (weekends off)
        { id: 'dec-2026-day', label: 'Day / evening shift', from: '2026-12-01', to: null,
          days: [1, 2, 3, 4, 5], start: '12:00', end: '23:00' }
      ],
      skincare: { am: ['Cleanse', 'Moisturise', 'Sunscreen'], pm: ['Cleanse', 'Moisturise'] },
      hair: hair
    };
  }

  // Make sure a day record always has every field with the right type.
  function sanitizeDay(d) {
    d = d && typeof d === 'object' ? d : {};
    var s = d.study || {}, sl = d.sleep || {}, sk = d.skincare || {}, h = d.hair || {},
      ex = d.exercise || {}, m = d.meals || {}, r = d.reading || {}, st = d.steps || {};
    var sessions = Array.isArray(sl.sessions) ? sl.sessions.slice(0, 20) : [];
    return {
      study: { minutes: num(s.minutes, 1440), topic: str(s.topic, 200), notes: str(s.notes) },
      sleep: {
        manualMinutes: num(sl.manualMinutes, 1440), note: str(sl.note),
        sessions: sessions.map(function (x) { return { start: dtStr(x && x.start), end: dtStr(x && x.end) }; })
      },
      skincare: { am: sk.am === true, pm: sk.pm === true },
      hair: { done: h.done === true, notes: str(h.notes) },
      exercise: { done: ex.done === true, minutes: num(ex.minutes, 1440), type: str(ex.type, 200) },
      meals: { done: [0, 1, 2].map(function (i) { return Array.isArray(m.done) && m.done[i] === true; }), food: str(m.food) },
      reading: { minutes: num(r.minutes, 1440), book: str(r.book, 200), page: str(r.page, 100) },
      steps: { count: num(st.count, 200000) }
    };
  }

  function cleanSteps(arr, fallback) {
    if (!Array.isArray(arr)) return fallback;
    return arr.filter(function (x) { return typeof x === 'string'; })
      .map(function (x) { return x.trim().slice(0, 80); })
      .filter(Boolean).slice(0, 15);
  }

  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var out = defaultSettings();
    if (typeof s.boundary === 'string' && TIME_RE.test(s.boundary)) out.boundary = s.boundary;

    if (Array.isArray(s.schedules)) {
      var list = [];
      s.schedules.slice(0, 50).forEach(function (r, i) {
        if (!r || typeof r !== 'object') return;
        if (!isRealDate(r.from || '') || !TIME_RE.test(r.start || '') || !TIME_RE.test(r.end || '')) return;
        var to = (typeof r.to === 'string' && isRealDate(r.to) && r.to >= r.from) ? r.to : null;
        var days = Array.isArray(r.days) ? r.days.map(Number).filter(function (n) { return n >= 0 && n <= 6 && Math.floor(n) === n; }) : [];
        days = days.filter(function (n, idx) { return days.indexOf(n) === idx; }).sort();
        list.push({ id: str(r.id, 60) || ('rule-' + i), label: str(r.label, 60), from: r.from, to: to, days: days, start: r.start, end: r.end });
      });
      out.schedules = list;
    }
    if (s.skincare && typeof s.skincare === 'object') {
      out.skincare.am = cleanSteps(s.skincare.am, out.skincare.am);
      out.skincare.pm = cleanSteps(s.skincare.pm, out.skincare.pm);
    }
    if (s.hair && typeof s.hair === 'object') {
      for (var i = 0; i < 7; i++) {
        var h = s.hair[i] || {};
        out.hair[i] = { wash: h.wash === true, condition: h.condition === true, other: str(h.other, 100) };
      }
    }
    return out;
  }

  function sanitizeData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (!obj.settings || typeof obj.settings !== 'object') return null;
    if (!obj.days || typeof obj.days !== 'object' || Array.isArray(obj.days)) return null;
    var days = {};
    Object.keys(obj.days).forEach(function (k) {
      if (isRealDate(k)) days[k] = sanitizeDay(obj.days[k]);
    });
    return { app: APP_ID, version: DATA_VERSION, settings: sanitizeSettings(obj.settings), days: days };
  }

  function freshData() {
    return { app: APP_ID, version: DATA_VERSION, settings: defaultSettings(), days: {} };
  }

  var data = freshData();
  var storageOK = true;

  // Load everything saved from last time.
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (err) { storageOK = false; return freshData(); }
    if (!raw) return freshData();
    try {
      var clean = sanitizeData(JSON.parse(raw));
      if (clean) return clean;
    } catch (err) { /* fall through */ }
    // Stored text could not be read: keep a copy so nothing is silently lost.
    try { localStorage.setItem(STORAGE_KEY + '.unreadable', raw); } catch (err) { /* ignore */ }
    return freshData();
  }

  // Save everything. Days with nothing recorded are dropped first so they don't pile up.
  var saveTimer = null;
  function save() {
    Object.keys(data.days).forEach(function (k) { if (!isTracked(data.days[k])) delete data.days[k]; });
    var el = $('saveStatus');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      el.classList.remove('error');
      el.textContent = '✓ Changes saved';
      el.classList.add('show');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
      return true;
    } catch (err) {
      $('storageWarning').hidden = false;
      el.textContent = 'Could not save — browser storage is unavailable';
      el.classList.add('show');
      return false;
    }
  }

  /* ---------------------------------------------------------
     5. PERSONAL DAY & WORK SCHEDULE LOGIC
     --------------------------------------------------------- */

  // The personal date for "right now": before the boundary time (06:00 by default)
  // we are still on the PREVIOUS personal day. Midnight is NOT the end of the day.
  function personalDateFor(now, boundary) {
    var mins = now.getHours() * 60 + now.getMinutes();
    var today = keyOf(now);
    return mins < minutesOfDay(boundary) ? addDays(today, -1) : today;
  }
  function personalToday() { return personalDateFor(new Date(), data.settings.boundary); }

  // Which schedule applies to a personal date?
  // Among rules whose date range covers the date, the one with the LATEST start wins.
  function scheduleInfo(key) {
    var wd = dateOf(key).getDay();
    var best = null;
    data.settings.schedules.forEach(function (r) {
      if (r.from <= key && (!r.to || key <= r.to) && (!best || r.from > best.from)) best = r;
    });
    if (!best) return { rule: null, working: false, crosses: false, text: 'No work schedule is set for this date' };
    var working = best.days.indexOf(wd) !== -1;
    var crosses = best.end < best.start; // e.g. 16:30 → 02:30 runs past midnight
    var text;
    if (working) {
      text = (best.label ? best.label + ': ' : 'Work: ') + fmtTime(best.start) + ' – ' + fmtTime(best.end) + (crosses ? ' (next day)' : '');
    } else {
      text = 'Non-working day — no office shift scheduled';
    }
    return { rule: best, working: working, crosses: crosses, text: text };
  }

  function boundaryNote(info) {
    if (!info.rule || !info.working || !info.crosses) return '';
    var b = data.settings.boundary;
    if (info.rule.end <= b) {
      return 'Your shift ends at ' + fmtTime(info.rule.end) + ', before your ' + fmtTime(b) +
        ' day boundary — so late-night activity still counts toward this personal day.';
    }
    return 'Your shift ends at ' + fmtTime(info.rule.end) + ', after your ' + fmtTime(b) +
      ' day boundary — so the end of the shift falls on the next personal day.';
  }

  // Optional routine suggestions (not a timetable) that adapt to the day's schedule.
  function routineGuide(key) {
    var info = scheduleInfo(key);
    var r = info.rule;
    if (r && info.working && info.crosses) {
      return { title: 'Night-shift routine (' + fmtTime(r.start) + '–' + fmtTime(r.end) + ')', items: [
        ['After waking', 'Skincare and your first meal.'],
        ['Before work', 'Focused career-switch study, exercise and walking.'],
        ['Before or during work', 'Remaining meals and step tracking.'],
        ['After work', 'Wind down and prepare for sleep.'],
        ['Reading', 'Any convenient 30-minute period.']
      ] };
    }
    if (r && info.working) {
      return { title: 'Work-day routine (' + fmtTime(r.start) + '–' + fmtTime(r.end) + ')', items: [
        ['Before work', 'Focused study, exercise, skincare and walking where practical.'],
        ['Before or during work', 'Meals and step tracking.'],
        ['After work', 'Wind down and prepare for sleep.'],
        ['Reading', 'Any convenient 30-minute period.']
      ] };
    }
    if (r) {
      return { title: 'Day off — flexible routine', items: [
        ['Study', 'A longer focus block whenever your energy is best.'],
        ['Movement', 'Exercise and walking at a time that suits you.'],
        ['Meals', 'Three unhurried meals.'],
        ['Reading', 'Any convenient 30-minute period.'],
        ['Self-care', 'Skincare and hair care, no rush.']
      ] };
    }
    return { title: 'Flexible routine', items: [
      ['Study', 'Fit in focused study whenever it works for you.'],
      ['Movement', 'Exercise and walking at times that suit your day.'],
      ['Meals', 'Three meals spread through your day.'],
      ['Reading', 'Any convenient 30-minute period.'],
      ['Self-care', 'Skincare and hair care around your plans.']
    ] };
  }

  function guideHtml(key, open) {
    var g = routineGuide(key);
    var items = g.items.map(function (i) { return '<li><strong>' + esc(i[0]) + ':</strong> ' + esc(i[1]) + '</li>'; }).join('');
    return '<details class="guide"' + (open ? ' open' : '') + '><summary>' + esc(g.title) + '</summary><ul>' + items +
      '</ul><p class="guide-note">Just suggestions — complete your habits in any order, at any time.</p></details>';
  }

  /* ---------------------------------------------------------
     6. DAY RECORDS & COMPLETION RULES
     --------------------------------------------------------- */

  // Read-only look at a day (never creates a record).
  function peekEntry(key) { return data.days[key] || sanitizeDay({}); }
  // Editable day (created on demand; empty days are dropped when saving).
  function getEntry(key) {
    if (!data.days[key]) data.days[key] = sanitizeDay({});
    return data.days[key];
  }

  function sessionMs(s) {
    if (!s.start || !s.end) return null;
    var a = new Date(s.start).getTime(), b = new Date(s.end).getTime();
    if (!isFinite(a) || !isFinite(b) || b <= a) return null;
    return [a, b];
  }

  // Total sleep for a day.
  // Sessions may cross midnight (start and end are full date-times).
  // Overlapping sessions are merged first so the same minutes are never counted twice.
  // If no valid session exists, the quick "hours + minutes" entry is used instead.
  function validSessions(e) { return e.sleep.sessions.map(sessionMs).filter(Boolean); }
  function sleepMinutes(e) {
    var iv = validSessions(e).sort(function (x, y) { return x[0] - y[0]; });
    if (!iv.length) return e.sleep.manualMinutes;
    var total = 0, curS = iv[0][0], curE = iv[0][1];
    for (var i = 1; i < iv.length; i++) {
      if (iv[i][0] <= curE) { curE = Math.max(curE, iv[i][1]); }
      else { total += curE - curS; curS = iv[i][0]; curE = iv[i][1]; }
    }
    total += curE - curS;
    return Math.round(total / 60000);
  }

  // Which of the eight habits are complete?
  function habitStatus(e) {
    return {
      study: e.study.minutes >= TARGET.study,
      sleep: sleepMinutes(e) >= TARGET.sleep,
      skincare: e.skincare.am && e.skincare.pm,
      hair: e.hair.done,
      exercise: e.exercise.done,
      meals: e.meals.done.every(Boolean),
      reading: e.reading.minutes >= TARGET.reading,
      steps: e.steps.count >= TARGET.steps
    };
  }
  function completedCount(e) {
    var st = habitStatus(e), n = 0;
    HABITS.forEach(function (h) { if (st[h.id]) n++; });
    return n;
  }

  // Does a day have ANY information? (Used to tell "nothing recorded" apart from "0 progress".)
  function isTracked(e) {
    return e.study.minutes > 0 || has(e.study.topic) || has(e.study.notes) ||
      e.sleep.sessions.length > 0 || e.sleep.manualMinutes > 0 || has(e.sleep.note) ||
      e.skincare.am || e.skincare.pm || e.hair.done || has(e.hair.notes) ||
      e.exercise.done || e.exercise.minutes > 0 || has(e.exercise.type) ||
      e.meals.done.some(Boolean) || has(e.meals.food) ||
      e.reading.minutes > 0 || has(e.reading.book) || has(e.reading.page) || e.steps.count > 0;
  }

  // Colour level for calendar / week dots.
  function levelOf(key, today) {
    var e = data.days[key];
    if (!e || !isTracked(e)) return key > today ? 'future' : 'none';
    var c = completedCount(e);
    if (c === 8) return 'l4';
    if (c >= 5) return 'l3';
    if (c >= 1) return 'l2';
    return 'l1';
  }

  // Streak = consecutive personal days (ending today, or yesterday if today isn't done yet)
  // on which the habit was recorded as complete. Untracked days simply end a streak.
  function streakFor(pred) {
    var k = personalToday();
    if (!pred(k)) k = addDays(k, -1);
    var n = 0;
    while (n < 3660 && pred(k)) { n++; k = addDays(k, -1); }
    return n;
  }
  function habitDone(id) { return function (key) { var e = data.days[key]; return !!e && habitStatus(e)[id]; }; }
  function allDone(key) { var e = data.days[key]; return !!e && completedCount(e) === 8; }

  /* ---------------------------------------------------------
     7. MONTHLY STATISTICS (calculated only from saved records)
     --------------------------------------------------------- */
  function monthStats(year, m0) {
    var keys = monthKeys(year, m0), today = personalToday();
    var s = { year: year, m0: m0, daysInMonth: keys.length, elapsed: 0, tracked: 0, completed: 0, allEight: 0,
      studyMin: 0, sleepOK: 0, skin: 0, hair: 0, exercise: 0, meals: 0, readMin: 0, readOK: 0, stepsOK: 0, perDay: [] };
    keys.forEach(function (k) {
      if (k <= today) s.elapsed++;
      var e = data.days[k];
      var tracked = !!e && isTracked(e);
      var row = { key: k, day: Number(k.slice(8)), tracked: tracked, count: 0, studyMin: 0, future: k > today };
      if (tracked) {
        var st = habitStatus(e), c = completedCount(e);
        s.tracked++; s.completed += c; if (c === 8) s.allEight++;
        s.studyMin += e.study.minutes; row.studyMin = e.study.minutes; row.count = c;
        if (st.sleep) s.sleepOK++;
        if (st.skincare) s.skin++;
        if (st.hair) s.hair++;
        if (st.exercise) s.exercise++;
        if (st.meals) s.meals++;
        if (st.reading) s.readOK++;
        if (st.steps) s.stepsOK++;
        s.readMin += e.reading.minutes;
      }
      s.perDay.push(row);
    });
    return s;
  }

  /* ---------------------------------------------------------
     8. SMALL HTML BUILDERS
     --------------------------------------------------------- */
  function barHtml(p, label) {
    p = Math.max(0, Math.min(100, p));
    return '<div class="bar' + (p >= 100 ? ' full' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      Math.round(p) + '" aria-label="' + esc(label) + '"><span style="width:' + p + '%"></span></div>';
  }
  function progressHtml(value, target, text) {
    var p = Math.min(100, (value / target) * 100);
    return '<div class="progress-line"><span class="progress-text">' + text + '</span><span class="progress-pct">' +
      Math.round(p) + '%</span></div>' + barHtml(p, text);
  }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }

  /* ---------------------------------------------------------
     9. NAVIGATION
     --------------------------------------------------------- */
  var VIEWS = ['dashboard', 'tracker', 'monthly', 'settings'];
  var currentView = 'dashboard';
  var viewDate = null;           // personal date shown in the Daily Tracker
  var monthSel = { year: 2026, m0: 10 };
  var calSelected = null;

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = 'dashboard';
    currentView = name;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.nav-link').forEach(function (a) {
      if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (name === 'dashboard') renderDashboard();
    if (name === 'tracker') renderTracker();
    if (name === 'monthly') renderMonthly();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  function go(name) {
    if (location.hash === '#' + name) showView(name); else location.hash = name;
  }
  function rerender() { showView(currentView); }

  /* ---------------------------------------------------------
     10. DASHBOARD
     --------------------------------------------------------- */
  function motivation(done, tracked) {
    if (!tracked) return 'A fresh day. Tick off one small thing to begin — every little step counts.';
    if (done === 8) return 'You showed up for yourself today. You\u2019re becoming her, one day at a time.';
    if (done >= 5) return 'Progress is better than perfection. You\u2019re becoming her, one small step at a time.';
    if (done >= 1) return 'Every little step counts. You\u2019re becoming her, one small step at a time.';
    return 'You\u2019ve started — and that matters. Tomorrow is another opportunity.';
  }

  function streakBox(label, n) {
    return '<div class="streak"><span class="small muted">' + label + '</span><strong>' + (n > 0 ? n + (n === 1 ? ' day' : ' days') : '—') +
      '</strong><span class="small muted">' + (n > 0 ? 'in a row' : 'starts with your next completed day') + '</span></div>';
  }

  function renderDashboard() {
    var key = personalToday(), e = peekEntry(key), st = habitStatus(e);
    var done = completedCount(e), tracked = isTracked(e), info = scheduleInfo(key);
    var sleepMin = sleepMinutes(e);
    var remaining = HABITS.filter(function (h) { return !st[h.id]; }).map(function (h) { return h.name; });

    // Weekly consistency: the 7 personal days ending today
    var today = key, week = [], recorded = 0, eight = 0, sumCount = 0;
    for (var i = 6; i >= 0; i--) {
      var k = addDays(today, -i), de = data.days[k], lvl = levelOf(k, today);
      if (de && isTracked(de)) { recorded++; var c = completedCount(de); sumCount += c; if (c === 8) eight++; }
      week.push('<div class="week-day"><span class="dot ' + lvl + '" title="' + esc(fmtDateShort(k)) + '">' +
        (de && isTracked(de) ? completedCount(de) : '') + '</span><span>' + WEEKDAYS[dateOf(k).getDay()].slice(0, 3) + '</span></div>');
    }
    var weekText = recorded
      ? 'Recorded on ' + recorded + ' of the last 7 days · all 8 habits on ' + eight + ' day' + (eight === 1 ? '' : 's') +
        ' · average ' + (sumCount / recorded).toFixed(1) + ' of 8 habits (recorded days only)'
      : 'Nothing recorded in the last 7 days yet — today is a good day to start.';

    // Monthly overview for the current personal month
    var d = dateOf(today), ms = monthStats(d.getFullYear(), d.getMonth());
    var monthPct = ms.tracked ? pct(ms.completed, ms.tracked * 8) : 0;
    var monthHtml = '<h3>' + MONTHS[ms.m0] + ' ' + ms.year + '</h3>' +
      (ms.tracked
        ? '<p class="stat-sub">Tracked ' + ms.tracked + ' of ' + ms.elapsed + ' days so far · all 8 habits on ' + ms.allEight + ' day' + (ms.allEight === 1 ? '' : 's') + '</p>' +
          progressHtml(monthPct, 100, 'Habits completed on tracked days: ' + ms.completed + ' of ' + (ms.tracked * 8))
        : '<p class="muted">No days recorded this month yet.</p>') +
      '<p style="margin-top:12px"><a href="#monthly">See full monthly progress →</a></p>';

    var targets =
      '<div class="target-row">' + progressHtml(e.study.minutes, TARGET.study, 'Study · ' + fmtDur(e.study.minutes) + ' of 3h') + '</div>' +
      '<div class="target-row">' + progressHtml(sleepMin, TARGET.sleep, 'Sleep · ' + fmtDur(sleepMin) + ' of 6h') + '</div>' +
      '<div class="target-row">' + progressHtml(e.reading.minutes, TARGET.reading, 'Reading · ' + e.reading.minutes + ' of 30 min') + '</div>' +
      '<div class="target-row">' + progressHtml(e.steps.count, TARGET.steps, 'Steps · ' + e.steps.count.toLocaleString('en-IN') + ' of 10,000') + '</div>';

    var html =
      '<div class="card hero">' +
        '<p class="stat-label">Today (personal day)</p>' +
        '<p class="date">' + esc(fmtDateLong(key)) + '</p>' +
        '<p class="schedule-line">' + esc(info.text) + '</p>' +
        '<p class="muted small">' + esc(boundaryNote(info)) + '</p>' +
        '<p class="message">' + esc(motivation(done, tracked)) + '</p>' +
        '<p style="margin-top:14px"><button type="button" class="btn" id="dashCheckin">Open today\u2019s check-in</button></p>' +
      '</div>' +
      '<div class="grid">' +
        '<div class="card"><p class="stat-label">Today\u2019s completion</p><p class="stat-big">' + pct(done, 8) + '%</p>' +
          barHtml(pct(done, 8), 'Overall daily completion') + '<p class="stat-sub">' + done + ' of 8 habits complete</p></div>' +
        '<div class="card"><p class="stat-label">Still to go</p><p class="stat-big">' + (8 - done) + '</p>' +
          '<p class="stat-sub">' + (remaining.length ? esc(remaining.join(' · ')) : 'All eight done — lovely.') + '</p></div>' +
      '</div>' +
      '<div class="card"><h3>Today\u2019s targets</h3>' + targets + '</div>' +
      '<div class="grid">' +
        '<div class="card"><h3>This week</h3><div class="week-row">' + week.join('') + '</div><p class="stat-sub">' + esc(weekText) + '</p></div>' +
        '<div class="card"><h3>Consistency</h3><div class="streaks">' +
          streakBox('Study', streakFor(habitDone('study'))) + streakBox('Reading', streakFor(habitDone('reading'))) +
          streakBox('Walking', streakFor(habitDone('steps'))) + streakBox('All 8 habits', streakFor(allDone)) +
        '</div><p class="stat-sub">Streaks count only days you recorded as complete.</p></div>' +
      '</div>' +
      '<div class="card">' + monthHtml + '</div>' +
      '<div class="card"><h3>Today\u2019s routine ideas</h3>' + guideHtml(key, true) + '</div>';

    setHtml('dashboardContent', html);
    $('dashCheckin').addEventListener('click', function () { viewDate = personalToday(); go('tracker'); });
  }

  /* ---------------------------------------------------------
     11. DAILY TRACKER
     --------------------------------------------------------- */
  function dayRangeText(key) {
    var b = data.settings.boundary;
    if (b === '00:00') return 'Midnight to midnight';
    return 'Runs from ' + fmtTime(b) + ' to ' + fmtTime(b) + ' the next morning';
  }

  function renderTracker() {
    var today = personalToday();
    $('dateInput').value = viewDate;
    var rel = viewDate === today ? 'Today' : (viewDate < today ? 'Past day' : 'Upcoming day');
    $('dayTitle').textContent = fmtDateLong(viewDate);
    $('dayMeta').textContent = rel + ' · ' + dayRangeText(viewDate);

    var info = scheduleInfo(viewDate);
    setHtml('scheduleBox',
      '<p class="schedule-line">' + esc(info.text) + '</p>' +
      (boundaryNote(info) ? '<p class="muted small">' + esc(boundaryNote(info)) + '</p>' : '') +
      guideHtml(viewDate, false));

    setHtml('habitList', habitCardsHtml(peekEntry(viewDate)));
    refreshDaily();
  }

  // --- tiny form-field builders (data-path tells the handler where to store the value) ---
  function textInput(id, label, path, value, ph) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input type="text" id="' + id +
      '" data-kind="text" data-path="' + path + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '" autocomplete="off"></div>';
  }
  function textArea(id, label, path, value, ph) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="2" data-kind="text" data-path="' +
      path + '" placeholder="' + esc(ph || '') + '">' + esc(value) + '</textarea></div>';
  }
  function numInput(id, label, path, value, max, ph) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input type="number" inputmode="numeric" id="' + id +
      '" data-kind="int" data-max="' + max + '" data-path="' + path + '" min="0" max="' + max + '" step="1" value="' +
      (value > 0 ? value : '') + '" placeholder="' + (ph || '0') + '"></div>';
  }
  // Hours + minutes pair that is stored as total minutes at "path"
  function hmInputs(prefix, path, total) {
    var h = total > 0 ? Math.floor(total / 60) : '', m = total > 0 ? total % 60 : '';
    return '<div class="field-row">' +
      '<div class="field"><label for="' + prefix + 'H">Hours</label><input type="number" inputmode="numeric" id="' + prefix +
      'H" data-hm="' + path + '" data-part="h" min="0" max="24" step="1" value="' + h + '" placeholder="0"></div>' +
      '<div class="field"><label for="' + prefix + 'M">Minutes</label><input type="number" inputmode="numeric" id="' + prefix +
      'M" data-hm="' + path + '" data-part="m" min="0" max="59" step="1" value="' + m + '" placeholder="0"></div></div>';
  }
  function checkbox(id, label, path, checked) {
    return '<label class="check" for="' + id + '"><input type="checkbox" id="' + id + '" data-kind="check" data-path="' + path + '"' +
      (checked ? ' checked' : '') + '><span>' + label + '</span></label>';
  }
  function cardHead(id, title, target, checkHtml) {
    return '<header class="habit-head">' + (checkHtml || '<span class="habit-title">' + title + '</span>') +
      '<span class="badge" id="badge-' + id + '"></span></header><p class="target">Target: ' + target + '</p>';
  }

  function sessionRowHtml(s, i) {
    return '<div class="session"><div class="field-row">' +
      '<div class="field"><label for="ss' + i + '">Fell asleep</label><input type="datetime-local" id="ss' + i + '" data-session="' + i + '" data-which="start" value="' + esc(s.start) + '"></div>' +
      '<div class="field"><label for="se' + i + '">Woke up</label><input type="datetime-local" id="se' + i + '" data-session="' + i + '" data-which="end" value="' + esc(s.end) + '"></div>' +
      '<button type="button" class="btn btn-small btn-ghost" data-action="remove-session" data-i="' + i + '" style="margin-bottom:12px">Remove</button></div>' +
      '<p class="session-dur" data-dur="' + i + '"></p></div>';
  }

  function hairPlanText(key) {
    var h = data.settings.hair[dateOf(key).getDay()] || {};
    var parts = [];
    if (h.wash) parts.push('Wash');
    if (h.condition) parts.push('Condition');
    if (has(h.other)) parts.push(h.other.trim());
    if (parts.length) return 'Planned for ' + WEEKDAYS[dateOf(key).getDay()] + ': <strong>' + parts.map(esc).join(' + ') + '</strong>';
    return 'Nothing special planned for ' + WEEKDAYS[dateOf(key).getDay()] + '. Tick the box if you did any hair care. <a href="#settings">Edit weekly schedule</a>';
  }

  function habitCardsHtml(e) {
    var sk = data.settings.skincare;
    var stepsText = function (arr) { return arr.length ? esc(arr.join(' → ')) : 'no steps set'; };
    var cards = [];

    // 1. Study
    cards.push('<article class="habit" id="card-study">' +
      cardHead('study', 'Career Switch Study', '3 hours',
        '<label class="check" for="studyCheck"><input type="checkbox" id="studyCheck" disabled><span class="habit-title">Career Switch Study</span></label>') +
      '<div class="progress-block" id="prog-study"></div>' +
      hmInputs('study', 'study.minutes', e.study.minutes) +
      textInput('studyTopic', 'Subject or topic (optional)', 'study.topic', e.study.topic, 'What are you studying?') +
      textArea('studyNotes', 'Notes (optional)', 'study.notes', e.study.notes, 'What did you cover?') +
      '<p class="hint">This box ticks itself once your recorded time reaches 3 hours — only time you enter is counted.</p></article>');

    // 2. Sleep
    var sessions = e.sleep.sessions.map(sessionRowHtml).join('');
    cards.push('<article class="habit" id="card-sleep">' + cardHead('sleep', 'Sleep', '6 hours') +
      '<div class="progress-block" id="prog-sleep"></div>' +
      '<p class="small"><strong>Sleep sessions</strong> — enter when you fell asleep and woke up; crossing midnight is fine. Overlapping sessions are never double-counted.</p>' +
      '<div id="sessionList">' + sessions + '</div>' +
      '<button type="button" class="btn btn-small btn-ghost" data-action="add-session">+ Add a sleep session</button>' +
      '<p class="small" style="margin-top:14px"><strong>Or enter a quick total</strong> (used only when there are no valid sessions)</p>' +
      hmInputs('sleepQ', 'sleep.manualMinutes', e.sleep.manualMinutes) +
      textInput('sleepNote', 'Note (optional)', 'sleep.note', e.sleep.note, 'e.g. woke up twice') +
      '<p class="hint">Record sleep under the personal day you want it to count toward.</p></article>');

    // 3. Skincare
    cards.push('<article class="habit" id="card-skincare">' + cardHead('skincare', 'Skincare', 'After waking + before sleep',
        '<span class="habit-title">Skincare</span>') +
      '<div class="progress-block" id="prog-skincare"></div>' +
      checkbox('skinAmCheck', 'After-waking skincare done', 'skincare.am', e.skincare.am) +
      '<p class="hint" style="margin:0 0 8px 36px">' + stepsText(sk.am) + '</p>' +
      checkbox('skinPmCheck', 'Before-sleep skincare done', 'skincare.pm', e.skincare.pm) +
      '<p class="hint" style="margin:0 0 4px 36px">' + stepsText(sk.pm) + '</p>' +
      '<p class="hint">Edit your steps in <a href="#settings">Settings</a>.</p></article>');

    // 4. Hair care
    cards.push('<article class="habit" id="card-hair">' + cardHead('hair', 'Hair Care', 'Per your weekly schedule', '<span class="habit-title">Hair Care</span>') +
      '<div class="plan-note">' + hairPlanText(viewDate) + '</div>' +
      checkbox('hairCheck', 'Hair care done today', 'hair.done', e.hair.done) +
      textArea('hairNotes', 'Notes (optional)', 'hair.notes', e.hair.notes, 'e.g. oiled, washed, conditioned') +
      '<div class="progress-block" id="prog-hair"></div></article>');

    // 5. Exercise
    cards.push('<article class="habit" id="card-exercise">' + cardHead('exercise', 'Exercise', 'Complete my planned workout', '<span class="habit-title">Exercise</span>') +
      checkbox('exCheck', 'I completed my planned workout', 'exercise.done', e.exercise.done) +
      '<div class="field-row" style="margin-top:8px">' +
        numInput('exMin', 'Duration in minutes (optional)', 'exercise.minutes', e.exercise.minutes, 1440) +
        textInput('exType', 'Type (optional)', 'exercise.type', e.exercise.type, 'Home workout, walk…') + '</div>' +
      '<div class="progress-block" id="prog-exercise"></div>' +
      '<p class="hint">Home workouts and walking workouts count when you choose to record them. Log each activity once.</p></article>');

    // 6. Meals
    cards.push('<article class="habit" id="card-meals">' + cardHead('meals', 'Three Meals', '3 meals', '<span class="habit-title">Three Meals</span>') +
      '<div class="progress-block" id="prog-meals"></div>' +
      checkbox('meal0', 'Meal 1', 'meals.done.0', e.meals.done[0]) +
      checkbox('meal1', 'Meal 2', 'meals.done.1', e.meals.done[1]) +
      checkbox('meal2', 'Meal 3', 'meals.done.2', e.meals.done[2]) +
      textArea('foodNotes', 'What did you eat? (optional)', 'meals.food', e.meals.food, '') + '</article>');

    // 7. Reading
    cards.push('<article class="habit" id="card-reading">' + cardHead('reading', 'Book Reading', '30 minutes', '<span class="habit-title">Book Reading</span>') +
      '<div class="progress-block" id="prog-reading"></div>' +
      numInput('readMin', 'Minutes read', 'reading.minutes', e.reading.minutes, 1440) +
      textInput('readBook', 'Book (optional)', 'reading.book', e.reading.book, '') +
      textInput('readPage', 'Page or chapter (optional)', 'reading.page', e.reading.page, '') + '</article>');

    // 8. Steps
    cards.push('<article class="habit" id="card-steps">' + cardHead('steps', 'Walking', '10,000 steps', '<span class="habit-title">Walking</span>') +
      '<div class="progress-block" id="prog-steps"></div>' +
      numInput('stepCount', 'Steps completed', 'steps.count', e.steps.count, 200000) +
      '<p class="hint">Type the number from your phone or watch — nothing is synced automatically.</p></article>');

    return cards.join('');
  }

  // Update every derived piece of the tracker (bars, badges, summary) WITHOUT
  // re-creating the inputs, so typing is never interrupted.
  function refreshDaily() {
    var e = getEntry(viewDate), st = habitStatus(e), sleepMin = sleepMinutes(e);

    $('studyCheck').checked = st.study;
    setHtml('prog-study', progressHtml(e.study.minutes, TARGET.study,
      fmtDur(e.study.minutes) + ' of 3h' + (st.study ? '' : ' · ' + fmtDur(TARGET.study - e.study.minutes) + ' to go')));
    setHtml('prog-sleep', progressHtml(sleepMin, TARGET.sleep,
      fmtDur(sleepMin) + ' of 6h' + (st.sleep ? '' : ' · ' + fmtDur(TARGET.sleep - sleepMin) + ' to go')));

    var skinN = (e.skincare.am ? 1 : 0) + (e.skincare.pm ? 1 : 0);
    setHtml('prog-skincare', progressHtml(skinN, 2, st.skincare ? 'Routine complete ✓' : skinN + ' of 2 check-ins done'));

    setHtml('prog-hair', st.hair ? '<p class="small muted">Hair care done for today ✓</p>' : '');
    setHtml('prog-exercise', e.exercise.minutes > 0 ? '<p class="small muted">' + e.exercise.minutes + ' min recorded</p>' : '');

    var mealN = e.meals.done.filter(Boolean).length;
    setHtml('prog-meals', progressHtml(mealN, 3, mealN + '/3 meals completed'));
    setHtml('prog-reading', progressHtml(e.reading.minutes, TARGET.reading, e.reading.minutes + ' of 30 min'));
    setHtml('prog-steps', progressHtml(e.steps.count, TARGET.steps,
      e.steps.count.toLocaleString('en-IN') + ' steps' + (st.steps ? ' — goal reached!' : ' · ' + (TARGET.steps - e.steps.count).toLocaleString('en-IN') + ' to go')));

    HABITS.forEach(function (h) {
      var card = $('card-' + h.id), badge = $('badge-' + h.id);
      if (card) card.classList.toggle('done', !!st[h.id]);
      if (badge) badge.textContent = st[h.id] ? 'Done ✓' : '';
    });

    // Sleep sessions: show each duration, and pause the quick total when sessions exist.
    e.sleep.sessions.forEach(function (s, i) {
      var el = document.querySelector('[data-dur="' + i + '"]');
      if (!el) return;
      var ms = sessionMs(s);
      if (ms) el.textContent = 'Duration: ' + fmtDur(Math.round((ms[1] - ms[0]) / 60000));
      else if (s.start && s.end) el.textContent = 'Wake-up time must be after the time you fell asleep.';
      else el.textContent = 'Choose both times to count this session.';
    });
    var usingSessions = validSessions(e).length > 0;
    ['sleepQH', 'sleepQM'].forEach(function (id) { var el = $(id); if (el) el.disabled = usingSessions; });

    var done = completedCount(e);
    var remaining = HABITS.filter(function (h) { return !st[h.id]; }).map(function (h) { return h.name; });
    setHtml('dailySummary',
      '<div class="summary-top"><strong>' + done + '/8</strong><span>habits complete · ' + pct(done, 8) + '%</span></div>' +
      barHtml(pct(done, 8), 'Daily completion') +
      '<p class="small muted" style="margin:10px 0 0">' + (remaining.length ? 'Remaining: ' + esc(remaining.join(', ')) : 'Everything is done for this day. You showed up for yourself.') + '</p>');
  }

  function setPath(obj, path, val) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val;
  }

  // One handler for every input in the tracker (event delegation).
  function onTrackerInput(ev) {
    var t = ev.target;
    if (!t || !t.dataset) return;
    var e = getEntry(viewDate);

    if (t.dataset.session !== undefined) {                 // sleep session date-time
      var s = e.sleep.sessions[Number(t.dataset.session)];
      if (!s) return;
      s[t.dataset.which] = dtStr(t.value);
    } else if (t.dataset.hm) {                              // hours + minutes pair → total minutes
      var h = document.querySelector('[data-hm="' + t.dataset.hm + '"][data-part="h"]');
      var m = document.querySelector('[data-hm="' + t.dataset.hm + '"][data-part="m"]');
      var total = Math.min(num(h.value, 24) * 60 + num(m.value, 1440), 1440);
      setPath(e, t.dataset.hm, total);
    } else if (t.dataset.path) {
      if (t.dataset.kind === 'check') setPath(e, t.dataset.path, t.checked);
      else if (t.dataset.kind === 'int') setPath(e, t.dataset.path, num(t.value, Number(t.dataset.max) || 1000000));
      else setPath(e, t.dataset.path, t.value.slice(0, 2000));
    } else {
      return;
    }
    save();
    refreshDaily();
  }

  function onTrackerClick(ev) {
    var btn = ev.target.closest('[data-action]');
    if (!btn) return;
    var e = getEntry(viewDate);
    if (btn.dataset.action === 'add-session') {
      if (e.sleep.sessions.length >= 10) return;
      e.sleep.sessions.push({ start: '', end: '' });
    } else if (btn.dataset.action === 'remove-session') {
      e.sleep.sessions.splice(Number(btn.dataset.i), 1);
    } else {
      return;
    }
    setHtml('sessionList', e.sleep.sessions.map(sessionRowHtml).join(''));
    save();
    refreshDaily();
  }

  function setViewDate(key) {
    if (!isRealDate(key)) return;
    viewDate = key;
    renderTracker();
  }

  /* ---------------------------------------------------------
     12. MONTHLY PROGRESS
     --------------------------------------------------------- */
  function fillMonthSelectors() {
    var yearsSet = {}, thisYear = dateOf(personalToday()).getFullYear();
    var first = Math.min(2026, thisYear);
    Object.keys(data.days).forEach(function (k) { first = Math.min(first, Number(k.slice(0, 4))); });
    var last = Math.max(2030, thisYear + 2);
    for (var y = first; y <= last; y++) yearsSet[y] = true;
    $('yearSelect').innerHTML = Object.keys(yearsSet).map(function (y) {
      return '<option value="' + y + '"' + (Number(y) === monthSel.year ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
    $('monthSelect').innerHTML = MONTHS.map(function (m, i) {
      return '<option value="' + i + '"' + (i === monthSel.m0 ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
  }

  function statCard(label, value, sub) {
    return '<div class="card"><p class="stat-label">' + label + '</p><p class="stat-big">' + value + '</p><p class="stat-sub">' + sub + '</p></div>';
  }
  function rateRow(label, n, tracked, extra) {
    var p = pct(n, tracked);
    return '<div class="rate-row">' + progressHtml(p, 100, esc(label) + ' · ' + n + ' of ' + tracked + ' tracked days' + (extra || '')) + '</div>';
  }

  function chartHtml(title, rows, valueOf, maxVal, titleOf, targetVal) {
    var cols = rows.map(function (r) {
      var cls, style = '';
      if (!r.tracked) { cls = r.future ? 'fill futurebar' : 'fill empty'; style = r.future ? 'height:0' : ''; }
      else {
        var v = valueOf(r), h = Math.min(100, (v / maxVal) * 100);
        cls = 'fill' + (v === 0 ? ' stub' : (h >= 100 || (targetVal && v >= targetVal) ? ' l4' : ''));
        style = 'height:' + h + '%';
      }
      return '<div class="bar-col" title="' + esc(titleOf(r)) + '"><div class="' + cls + '" style="' + style + '"></div></div>';
    }).join('');
    var labels = rows.map(function (r) { return '<span>' + (r.day === 1 || r.day % 5 === 0 ? r.day : '') + '</span>'; }).join('');
    var line = targetVal ? '<div class="target-line" style="bottom:' + ((targetVal / maxVal) * 100) + '%"></div>' : '';
    return '<div class="card"><h3>' + title + '</h3><div class="chart">' + line + cols + '</div><div class="chart-labels">' + labels + '</div></div>';
  }

  function renderMonthly() {
    fillMonthSelectors();
    var s = monthStats(monthSel.year, monthSel.m0);
    var overall = s.tracked ? pct(s.completed, s.tracked * 8) : null;
    var avgTracked = s.tracked ? fmtDur(Math.round(s.studyMin / s.tracked)) : '—';
    var avgElapsed = s.elapsed ? fmtDur(Math.round(s.studyMin / s.elapsed)) : '—';

    var html = '<div class="grid">' +
      statCard('Personal days tracked', s.tracked, 'of ' + s.elapsed + ' days so far (' + s.daysInMonth + ' in the month). Days with nothing recorded are not counted as misses.') +
      statCard('Overall habit completion', overall === null ? '—' : overall + '%',
        s.tracked ? s.completed + ' of ' + (s.tracked * 8) + ' habit check-offs, on tracked days only' : 'Nothing recorded yet this month') +
      statCard('Days with all 8 habits', s.allEight, 'out of ' + s.tracked + ' tracked days') +
      statCard('Total study', fmtDur(s.studyMin), 'Hours recorded this month') +
      statCard('Average study per tracked day', avgTracked, 'Uses only the ' + s.tracked + ' days with recorded data. Across all ' + s.elapsed + ' elapsed calendar days it would be ' + avgElapsed + '.') +
      statCard('Total reading', s.readMin + ' min', s.readOK + ' day' + (s.readOK === 1 ? '' : 's') + ' reached 30 minutes') +
      '</div>';

    html += '<div class="card"><h3>Habit rates</h3>' +
      (s.tracked
        ? rateRow('Sleep (6 hours)', s.sleepOK, s.tracked) +
          rateRow('Skincare', s.skin, s.tracked) +
          rateRow('Hair care', s.hair, s.tracked) +
          rateRow('Exercise', s.exercise, s.tracked) +
          rateRow('All three meals', s.meals, s.tracked) +
          rateRow('Reading (30 min)', s.readOK, s.tracked) +
          rateRow('10,000 steps', s.stepsOK, s.tracked)
        : '<p class="muted">Rates will appear once you have recorded at least one day.</p>') +
      '<p class="hint">Rates are out of tracked days only.</p></div>';
    setHtml('monthStats', html);

    var maxStudy = Math.max(TARGET.study, Math.max.apply(null, s.perDay.map(function (r) { return r.studyMin; })));
    setHtml('monthCharts',
      chartHtml('Habits completed each day (out of 8)', s.perDay, function (r) { return r.count; }, 8,
        function (r) { return 'Day ' + r.day + ': ' + (r.tracked ? r.count + ' of 8 habits' : (r.future ? 'upcoming' : 'nothing recorded')); }) +
      chartHtml('Study each day (dashed line = 3 hours)', s.perDay, function (r) { return r.studyMin; }, maxStudy,
        function (r) { return 'Day ' + r.day + ': ' + (r.tracked ? fmtDur(r.studyMin) : (r.future ? 'upcoming' : 'nothing recorded')); }, TARGET.study));

    renderCalendar();
  }

  function renderCalendar() {
    var keys = monthKeys(monthSel.year, monthSel.m0), today = personalToday();
    var offset = (dateOf(keys[0]).getDay() + 6) % 7;      // Monday-first grid
    var html = '<div class="cal-grid">';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { html += '<div class="cal-dow">' + d + '</div>'; });
    for (var i = 0; i < offset; i++) html += '<div class="cal-blank"></div>';
    keys.forEach(function (k) {
      var lvl = levelOf(k, today), e = data.days[k];
      var label = fmtDateLong(k) + ': ' + (e && isTracked(e) ? completedCount(e) + ' of 8 habits complete' : (k > today ? 'upcoming' : 'nothing recorded'));
      html += '<button type="button" class="cal-day ' + lvl + (k === today ? ' is-today' : '') + (k === calSelected ? ' selected' : '') +
        '" data-date="' + k + '" aria-label="' + esc(label) + '">' + Number(k.slice(8)) + '</button>';
    });
    html += '</div>';
    setHtml('calendar', html);
    renderDayDetail();
  }

  function detailLine(name, done, text) {
    return '<li><span class="mark" aria-hidden="true">' + (done ? '✓' : '○') + '</span><span class="name">' + name +
      '</span><span class="txt">' + text + '</span></li>';
  }

  function renderDayDetail() {
    if (!calSelected) { setHtml('dayDetail', '<p class="muted">Select a date to see its saved record.</p>'); return; }
    var key = calSelected, e = peekEntry(key), st = habitStatus(e), tracked = isTracked(e), info = scheduleInfo(key);
    var today = personalToday();
    var html = '<h3>' + esc(fmtDateLong(key)) + '</h3><p class="schedule-line">' + esc(info.text) + '</p>';
    if (!tracked) {
      html += '<p class="muted">' + (key > today ? 'This is an upcoming day.' : 'Nothing was recorded for this day.') + '</p>';
    } else {
      var sleepMin = sleepMinutes(e), mealN = e.meals.done.filter(Boolean).length, none = '<span class="muted">Not recorded</span>';
      var extra = function (a) { return a.filter(has).map(esc).join(' · '); };
      html += '<p>' + completedCount(e) + ' of 8 habits complete.</p><ul class="detail-list">' +
        detailLine('Study', st.study, e.study.minutes ? fmtDur(e.study.minutes) + ' of 3h' + (extra([e.study.topic, e.study.notes]) ? ' · ' + extra([e.study.topic, e.study.notes]) : '') : none) +
        detailLine('Sleep', st.sleep, sleepMin ? fmtDur(sleepMin) + ' of 6h' + (has(e.sleep.note) ? ' · ' + esc(e.sleep.note) : '') : none) +
        detailLine('Skincare', st.skincare, 'After waking: ' + (e.skincare.am ? 'yes' : 'no') + ' · Before sleep: ' + (e.skincare.pm ? 'yes' : 'no')) +
        detailLine('Hair care', st.hair, (st.hair ? 'Done' : 'Not ticked') + (has(e.hair.notes) ? ' · ' + esc(e.hair.notes) : '')) +
        detailLine('Exercise', st.exercise, (st.exercise ? 'Done' : 'Not ticked') + (e.exercise.minutes ? ' · ' + e.exercise.minutes + ' min' : '') + (has(e.exercise.type) ? ' · ' + esc(e.exercise.type) : '')) +
        detailLine('Meals', st.meals, mealN + '/3 meals' + (has(e.meals.food) ? ' · ' + esc(e.meals.food) : '')) +
        detailLine('Reading', st.reading, e.reading.minutes ? e.reading.minutes + ' of 30 min' + (extra([e.reading.book, e.reading.page]) ? ' · ' + extra([e.reading.book, e.reading.page]) : '') : none) +
        detailLine('Walking', st.steps, e.steps.count ? e.steps.count.toLocaleString('en-IN') + ' steps' : none) +
        '</ul>';
    }
    html += '<button type="button" class="btn" data-action="edit-day" data-date="' + key + '">' + (tracked ? 'Edit this day' : 'Add entries for this day') + '</button>';
    setHtml('dayDetail', html);
  }

  /* ---------------------------------------------------------
     13. SETTINGS
     --------------------------------------------------------- */
  function renderSettings() {
    // Habit overview (read-only)
    setHtml('habitOverview', HABITS.map(function (h) { return '<li><strong>' + esc(h.name) + '</strong> · ' + esc(h.target) + '</li>'; }).join(''));

    $('boundaryInput').value = data.settings.boundary;
    updateBoundaryPreview();

    renderScheduleList();

    $('skinAm').value = data.settings.skincare.am.join('\n');
    $('skinPm').value = data.settings.skincare.pm.join('\n');

    var rows = WEEK_ORDER.map(function (d) {
      var h = data.settings.hair[d];
      return '<div class="hair-row" data-day="' + d + '"><span class="day-name">' + WEEKDAYS[d] + '</span>' +
        '<label class="check"><input type="checkbox" data-hf="wash"' + (h.wash ? ' checked' : '') + '><span>Wash</span></label>' +
        '<label class="check"><input type="checkbox" data-hf="condition"' + (h.condition ? ' checked' : '') + '><span>Condition</span></label>' +
        '<input type="text" data-hf="other" value="' + esc(h.other) + '" placeholder="Other (oil, mask…)" aria-label="Other hair care on ' + WEEKDAYS[d] + '"></div>';
    }).join('');
    setHtml('hairList', rows);
  }

  function updateBoundaryPreview() {
    var cand = $('boundaryInput').value;
    if (!TIME_RE.test(cand)) { $('boundaryPreview').textContent = 'Choose a time to see what it would change.'; return; }
    var now = new Date();
    var withNew = personalDateFor(now, cand), withOld = personalDateFor(now, data.settings.boundary);
    var timeNow = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    $('boundaryPreview').textContent =
      'Effect: anything recorded before ' + fmtTime(cand) + ' counts toward the previous day. Right now it is ' + timeNow +
      ', so “today” would be ' + fmtDateShort(withNew) + (withNew === withOld ? ' (no change).' : ' (it is currently ' + fmtDateShort(withOld) + ').');
  }

  function applyBoundary() {
    var cand = $('boundaryInput').value;
    if (!TIME_RE.test(cand)) { $('boundaryPreview').textContent = 'Please choose a valid time.'; return; }
    if (cand === data.settings.boundary) { $('boundaryPreview').textContent = 'That is already your boundary.'; return; }
    var ok = window.confirm(
      'Change your personal-day boundary from ' + fmtTime(data.settings.boundary) + ' to ' + fmtTime(cand) + '?\n\n' +
      '• Records you already saved stay on the dates they are saved under — nothing is moved.\n' +
      '• From now on, activity before ' + fmtTime(cand) + ' counts toward the previous day.\n' +
      '• Which date counts as “today” may change.');
    if (!ok) { $('boundaryInput').value = data.settings.boundary; updateBoundaryPreview(); return; }
    data.settings.boundary = cand;
    viewDate = personalToday();
    save();
    updateBoundaryPreview();
  }

  function scheduleRowHtml(r) {
    var id = esc(r.id);
    var dayChecks = WEEK_ORDER.map(function (d) {
      return '<label class="chip"><input type="checkbox" data-f="day" data-day="' + d + '"' + (r.days.indexOf(d) !== -1 ? ' checked' : '') +
        ' aria-label="' + WEEKDAYS[d] + '"><span>' + WEEKDAYS[d].slice(0, 3) + '</span></label>';
    }).join('');
    return '<div class="rule" data-id="' + id + '">' +
      '<div class="field-row">' +
        '<div class="field"><label for="' + id + '-label">Name</label><input type="text" id="' + id + '-label" data-f="label" value="' + esc(r.label) + '"></div>' +
        '<div class="field"><label for="' + id + '-from">Starts on</label><input type="date" id="' + id + '-from" data-f="from" value="' + r.from + '"></div>' +
        '<div class="field"><label for="' + id + '-to">Ends on (empty = ongoing)</label><input type="date" id="' + id + '-to" data-f="to" value="' + (r.to || '') + '"></div>' +
      '</div><div class="field-row">' +
        '<div class="field"><label for="' + id + '-start">Shift starts</label><input type="time" id="' + id + '-start" data-f="start" value="' + r.start + '"></div>' +
        '<div class="field"><label for="' + id + '-end">Shift ends</label><input type="time" id="' + id + '-end" data-f="end" value="' + r.end + '"></div>' +
      '</div>' +
      '<fieldset class="days"><legend>Working days</legend>' + dayChecks + '</fieldset>' +
      '<p class="hint">' + (r.end < r.start ? 'This shift finishes after midnight.' : '') + ' Days left unticked are non-working days.</p>' +
      '<button type="button" class="btn btn-small btn-ghost" data-action="del-rule">Remove this schedule</button></div>';
  }

  function renderScheduleList() {
    var list = data.settings.schedules.slice().sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    setHtml('scheduleList', list.length ? list.map(scheduleRowHtml).join('') : '<p class="muted">No schedules set. Add one below.</p>');
  }

  function onScheduleChange(ev) {
    var t = ev.target, row = t.closest('.rule');
    if (!row || !t.dataset.f) return;
    var r = data.settings.schedules.filter(function (x) { return x.id === row.dataset.id; })[0];
    if (!r) return;
    var msg = '', f = t.dataset.f;
    if (f === 'label') r.label = t.value.slice(0, 60);
    else if (f === 'from') {
      if (!isRealDate(t.value)) { msg = 'A start date is required.'; t.value = r.from; }
      else if (r.to && t.value > r.to) { msg = 'The start date cannot be after the end date.'; t.value = r.from; }
      else r.from = t.value;
    } else if (f === 'to') {
      if (!t.value) r.to = null;
      else if (!isRealDate(t.value) || t.value < r.from) { msg = 'The end date cannot be before the start date.'; t.value = r.to || ''; }
      else r.to = t.value;
    } else if (f === 'start' || f === 'end') {
      if (!TIME_RE.test(t.value)) { msg = 'Please enter a valid time.'; t.value = r[f]; }
      else r[f] = t.value;
    } else if (f === 'day') {
      var set = r.days.slice(), d = Number(t.dataset.day), at = set.indexOf(d);
      if (t.checked && at === -1) set.push(d);
      if (!t.checked && at !== -1) set.splice(at, 1);
      r.days = set.sort();
    }
    $('scheduleMsg').textContent = msg || 'Schedule updated. Your saved habit records were not changed.';
    if (!msg) save();
  }

  function onScheduleClick(ev) {
    var btn = ev.target.closest('[data-action="del-rule"]');
    if (!btn) return;
    var row = btn.closest('.rule');
    if (!window.confirm('Remove this schedule? Your saved habit records are not affected.')) return;
    data.settings.schedules = data.settings.schedules.filter(function (x) { return x.id !== row.dataset.id; });
    save();
    renderScheduleList();
    $('scheduleMsg').textContent = 'Schedule removed.';
  }

  function addSchedule() {
    data.settings.schedules.push({ id: uid(), label: 'New schedule', from: personalToday(), to: null,
      days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });
    save();
    renderScheduleList();
    $('scheduleMsg').textContent = 'New schedule added — set its dates, hours and days above.';
  }

  function onSkincareChange() {
    data.settings.skincare.am = cleanSteps($('skinAm').value.split('\n'), []);
    data.settings.skincare.pm = cleanSteps($('skinPm').value.split('\n'), []);
    save();
  }

  function onHairChange(ev) {
    var t = ev.target, row = t.closest('.hair-row');
    if (!row || !t.dataset.hf) return;
    var h = data.settings.hair[Number(row.dataset.day)];
    if (t.dataset.hf === 'other') h.other = t.value.slice(0, 100);
    else h[t.dataset.hf] = t.checked;
    save();
  }

  /* ---------------------------------------------------------
     14. BACKUP & RESTORE
     --------------------------------------------------------- */
  function exportBackup() {
    var payload = { app: APP_ID, version: DATA_VERSION, exportedAt: new Date().toISOString(), settings: data.settings, days: data.days };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'becoming-her-backup-' + personalToday() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $('backupMsg').textContent = 'Backup downloaded (' + Object.keys(data.days).length + ' recorded days).';
  }

  // Check a parsed backup file; returns { ok, error, data }
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'This file is not a Becoming Her backup.' };
    if (obj.app !== APP_ID) return { ok: false, error: 'This file was not created by Becoming Her.' };
    if (typeof obj.version !== 'number' || obj.version > DATA_VERSION) return { ok: false, error: 'This backup comes from a newer, unsupported version.' };
    if (!obj.settings || typeof obj.settings !== 'object') return { ok: false, error: 'The backup has no settings section.' };
    if (!obj.days || typeof obj.days !== 'object' || Array.isArray(obj.days)) return { ok: false, error: 'The backup has no daily records section.' };
    var clean = sanitizeData(obj);
    if (!clean) return { ok: false, error: 'The backup could not be read.' };
    return { ok: true, data: clean, exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '' };
  }

  function onImportFile(ev) {
    var input = ev.target, file = input.files && input.files[0];
    if (!file) return;
    var msg = $('backupMsg');
    var reader = new FileReader();
    reader.onerror = function () { msg.textContent = 'Could not read that file. Nothing was changed.'; input.value = ''; };
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (err) { msg.textContent = 'That file is not valid JSON. Nothing was changed.'; input.value = ''; return; }
      var result = validateBackup(parsed);
      if (!result.ok) { msg.textContent = result.error + ' Nothing was changed.'; input.value = ''; return; }
      var n = Object.keys(result.data.days).length;
      var when = result.exportedAt ? new Date(result.exportedAt).toLocaleString('en-IN') : 'an unknown date';
      var ok = window.confirm('Replace ALL your current data with this backup?\n\n' +
        '• ' + n + ' recorded day' + (n === 1 ? '' : 's') + ', exported ' + when + '\n' +
        '• Your current records and settings will be overwritten.\n\nTip: download a backup of your current data first if unsure.');
      if (!ok) { msg.textContent = 'Restore cancelled. Nothing was changed.'; input.value = ''; return; }
      try { localStorage.setItem(STORAGE_KEY + '.beforeRestore', JSON.stringify(data)); } catch (err) { /* safety copy is best-effort */ }
      data = result.data;
      viewDate = personalToday();
      if (save()) msg.textContent = 'Backup restored: ' + n + ' recorded day' + (n === 1 ? '' : 's') + ' loaded.';
      input.value = '';
      renderSettings();
    };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------
     15. START-UP
     --------------------------------------------------------- */
  function init() {
    data = loadData();
    if (!storageOK) $('storageWarning').hidden = false;
    viewDate = personalToday();
    var t = dateOf(viewDate);
    monthSel = { year: t.getFullYear(), m0: t.getMonth() };

    // Navigation
    window.addEventListener('hashchange', function () { showView(location.hash.replace('#', '')); });

    // Tracker
    $('prevDay').addEventListener('click', function () { setViewDate(addDays(viewDate, -1)); });
    $('nextDay').addEventListener('click', function () { setViewDate(addDays(viewDate, 1)); });
    $('todayBtn').addEventListener('click', function () { setViewDate(personalToday()); });
    $('dateInput').addEventListener('change', function (ev) { if (ev.target.value) setViewDate(ev.target.value); });
    $('habitList').addEventListener('input', onTrackerInput);
    $('habitList').addEventListener('change', onTrackerInput);
    $('habitList').addEventListener('click', onTrackerClick);

    // Monthly
    $('monthSelect').addEventListener('change', function (ev) { monthSel.m0 = Number(ev.target.value); calSelected = null; renderMonthly(); });
    $('yearSelect').addEventListener('change', function (ev) { monthSel.year = Number(ev.target.value); calSelected = null; renderMonthly(); });
    $('calendar').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-date]');
      if (!b) return;
      calSelected = b.dataset.date;
      renderCalendar();
    });
    $('dayDetail').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-action="edit-day"]');
      if (!b) return;
      viewDate = b.dataset.date;
      go('tracker');
    });

    // Settings
    $('boundaryInput').addEventListener('input', updateBoundaryPreview);
    $('boundaryApply').addEventListener('click', applyBoundary);
    $('scheduleList').addEventListener('change', onScheduleChange);
    $('scheduleList').addEventListener('click', onScheduleClick);
    $('addSchedule').addEventListener('click', addSchedule);
    $('skinAm').addEventListener('change', onSkincareChange);
    $('skinPm').addEventListener('change', onSkincareChange);
    $('hairList').addEventListener('input', onHairChange);
    $('hairList').addEventListener('change', onHairChange);
    $('exportBtn').addEventListener('click', exportBackup);
    $('importFile').addEventListener('change', onImportFile);

    showView(location.hash.replace('#', '') || 'dashboard');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();