/* Liga MX Tracker — datos en vivo de ESPN (API pública, sin clave).
   Partidos: scoreboard del día. Tabla/goleadores/equipos: se calculan
   agregando los partidos del torneo en curso (Apertura/Clausura). */
(function () {
  'use strict';

  var ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1';
  var DEBUG = /[?&]debug=1/.test(location.search);

  var state = {
    tab: 'partidos',
    dayOffset: 0,
    leaderKind: 'goles',
    scoreboard: null,
    season: null,
    teamInfo: {},
    refreshTimer: null,
    lastOk: {}
  };

  /* ---------------- utilidades ---------------- */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  var cache = {
    read: function (key) {
      try {
        var raw = localStorage.getItem('ligamx_' + key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) { return null; }
    },
    write: function (key, data) {
      try { localStorage.setItem('ligamx_' + key, JSON.stringify({ ts: Date.now(), data: data })); }
      catch (e) { /* almacenamiento lleno o bloqueado */ }
    }
  };

  function dbg() {
    if (!DEBUG) return;
    var el = $('debug');
    el.classList.remove('hidden');
    var args = Array.prototype.slice.call(arguments);
    el.textContent += args.map(function (a) {
      return typeof a === 'string' ? a : JSON.stringify(a, null, 1).slice(0, 3000);
    }).join(' ') + '\n';
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadWithCache(key, url) {
    return fetchJSON(url).then(function (data) {
      cache.write(key, data);
      state.lastOk[key] = Date.now();
      $('offlineBanner').classList.add('hidden');
      return { data: data, fresh: true };
    }).catch(function (err) {
      dbg('FAIL', url, String(err));
      var c = cache.read(key);
      if (c && c.data) {
        $('offlineBanner').classList.remove('hidden');
        return { data: c.data, fresh: false };
      }
      throw err;
    });
  }

  function fmtDate(d) {
    return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtTime(d) {
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }
  function dateKey(d) {
    var m = '' + (d.getMonth() + 1), day = '' + d.getDate();
    return d.getFullYear() + (m.length < 2 ? '0' + m : m) + (day.length < 2 ? '0' + day : day);
  }
  function dayForOffset(off) {
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d;
  }

  function teamLogo(t) {
    if (t && t.logos && t.logos[0] && t.logos[0].href) return t.logos[0].href;
    return '';
  }
  function logoImg(t) {
    var src = teamLogo(t);
    var name = esc((t && (t.shortDisplayName || t.displayName)) || '');
    if (src) return '<img src="' + esc(src) + '" alt="' + name + '" loading="lazy" onerror="this.style.display=\'none\'">';
    return '<span>' + esc(name.slice(0, 3).toUpperCase()) + '</span>';
  }
  function infoOf(teamId) {
    return state.teamInfo[teamId] || {};
  }
  function infoName(teamId) {
    var i = infoOf(teamId);
    return i.name || '';
  }

  function rememberTeams(competitors) {
    (competitors || []).forEach(function (c) {
      var t = c.team || {};
      if (t.id && !state.teamInfo[t.id]) {
        state.teamInfo[t.id] = {
          name: t.displayName || t.name,
          short: t.shortDisplayName || t.abbreviation,
          abbr: t.abbreviation,
          logo: teamLogo(t)
        };
      }
    });
  }

  /* ---------------- tabs ---------------- */
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
  });

  function switchTab(name) {
    state.tab = name;
    tabBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    ['partidos', 'tabla', 'goleadores', 'equipos'].forEach(function (t) {
      $('tab-' + t).hidden = (t !== name);
    });
    loadCurrentTab();
  }

  function loadingHTML(msg) {
    return '<div class="loading"><div class="spinner"></div>' + esc(msg || 'Cargando…') + '</div>';
  }
  function errorHTML(msg) {
    return '<div class="empty">' + esc(msg) + '<br><br><button class="lead-btn" onclick="location.reload()">Reintentar</button></div>';
  }

  function setTourneyLabels(label) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tourney]'), function (el) {
      el.textContent = label;
    });
  }

  /* ---------------- datos del torneo (agregado mensual) ---------------- */
  function tournamentMonths() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    var first = m < 6 ? 0 : 6; // ene-jun = Clausura, jul-dic = Apertura
    var months = [], i, mm;
    for (i = first; i <= m; i++) {
      mm = i + 1;
      months.push(y + (mm < 10 ? '0' + mm : '' + mm));
    }
    return {
      label: (m < 6 ? 'Clausura ' : 'Apertura ') + y,
      months: months,
      current: months[months.length - 1]
    };
  }

  function sidesOf(ev) {
    var comp = (ev.competitions || [])[0] || {};
    var home = null, away = null;
    (comp.competitors || []).forEach(function (c) {
      if (c.homeAway === 'home') home = c;
      else if (c.homeAway === 'away') away = c;
    });
    return { comp: comp, home: home, away: away };
  }

  // La tabla y el goleo oficiales son de temporada regular (jornadas 1-17).
  function isRegular(ev) {
    var w = ev.week && ev.week.number;
    if (w != null) return w <= 17;
    return true;
  }

  function computeSeason(events, label) {
    var table = {}, scorers = {}, clean = {};
    function rowFor(id) {
      if (!table[id]) table[id] = { id: id, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, form: [] };
      return table[id];
    }
    events.forEach(function (ev) {
      if (!ev || !ev.status || !ev.status.type || ev.status.type.state !== 'post') return;
      var s = sidesOf(ev);
      if (!s.home || !s.away || !s.home.team || !s.away.team) return;
      var hs = parseInt(s.home.score, 10), as = parseInt(s.away.score, 10);
      if (isNaN(hs) || isNaN(as)) return;
      if (!isRegular(ev)) return;
      var hid = s.home.team.id, aid = s.away.team.id;
      var H = rowFor(hid), A = rowFor(aid);
      H.pj++; A.pj++;
      H.gf += hs; H.gc += as; A.gf += as; A.gc += hs;
      if (hs > as) { H.g++; H.form.push('W'); A.p++; A.form.push('L'); }
      else if (hs < as) { A.g++; A.form.push('W'); H.p++; H.form.push('L'); }
      else { H.e++; A.e++; H.form.push('D'); A.form.push('D'); }

      (s.comp.details || []).forEach(function (d) {
        if (!d.scoringPlay) return;
        var txt = (d.type && d.type.text) || '';
        if (/own goal/i.test(txt)) return; // autogoles no cuentan al jugador
        var pl = (d.athletesInvolved || [])[0];
        if (!pl || !pl.displayName) return;
        var tid = (d.team && d.team.id) || '';
        var k = pl.displayName + '|' + tid;
        if (!scorers[k]) scorers[k] = { name: pl.displayName, teamId: tid, goals: 0 };
        scorers[k].goals++;
      });

      if (as === 0) clean[hid] = (clean[hid] || 0) + 1;
      if (hs === 0) clean[aid] = (clean[aid] || 0) + 1;
    });

    var rows = Object.keys(table).map(function (id) {
      var r = table[id];
      r.pts = r.g * 3 + r.e;
      r.dif = r.gf - r.gc;
      r.form = r.form.slice(-5);
      return r;
    });
    rows.sort(function (a, b) {
      return (b.pts - a.pts) || (b.dif - a.dif) || (b.gf - a.gf) || infoName(a.id).localeCompare(infoName(b.id));
    });
    rows.forEach(function (r, i) { r.pos = i + 1; });

    var scorerList = Object.keys(scorers).map(function (k) { return scorers[k]; })
      .sort(function (a, b) { return b.goals - a.goals; });
    var cleanList = Object.keys(clean).map(function (id) { return { teamId: id, n: clean[id] }; })
      .sort(function (a, b) { return b.n - a.n; });

    return { label: label, table: rows, scorers: scorerList, cleanSheets: cleanList };
  }

  function loadSeason(force) {
    if (state.season && !force) return Promise.resolve(state.season);
    var t = tournamentMonths();
    setTourneyLabels(t.label);
    dbg('Torneo:', t.label, 'meses:', t.months.join(','));
    var jobs = t.months.map(function (mm) {
      var key = 'month_' + mm;
      var c = (!force) ? cache.read(key) : null;
      var age = c ? Date.now() - c.ts : Infinity;
      var isCurrent = (mm === t.current);
      if (c && c.data && c.data.events && (!isCurrent || age < 10 * 60 * 1000)) {
        dbg('Mes en caché:', mm);
        return Promise.resolve({ data: c.data, fresh: false });
      }
      return loadWithCache(key, ESPN + '/scoreboard?dates=' + mm);
    });
    return Promise.all(jobs).then(function (results) {
      var seen = {}, events = [];
      results.forEach(function (r) {
        (r.data.events || []).forEach(function (e) {
          if (e && e.id && !seen[e.id]) { seen[e.id] = 1; events.push(e); }
        });
      });
      events.forEach(function (e) {
        var s = sidesOf(e);
        var list = (s.comp.competitors || []).slice();
        [s.home, s.away].forEach(function (x) { if (x && list.indexOf(x) < 0) list.push(x); });
        rememberTeams(list);
      });
      events.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      dbg('Eventos del torneo:', events.length,
          'con week:', events.filter(function(e){ return e.week && e.week.number != null; }).length);
      state.season = computeSeason(events, t.label);
      state.lastOk.season = Date.now();
      dbg('Equipos en tabla:', state.season.table.length,
          'goleadores:', state.season.scorers.length);
      return state.season;
    });
  }

  function ensureSeason(containerId, msg) {
    $(containerId).innerHTML = loadingHTML(msg);
    return loadSeason().catch(function () {
      $(containerId).innerHTML = errorHTML('No se pudieron cargar los datos del torneo.');
      throw new Error('season failed');
    });
  }

  /* ---------------- PARTIDOS ---------------- */
  function loadScoreboard(force) {
    var d = dayForOffset(state.dayOffset);
    var key = 'sb_' + dateKey(d);
    if (state.scoreboard && state.scoreboard.key === key && !force) {
      renderMatches();
      return Promise.resolve();
    }
    var url = ESPN + '/scoreboard' + (state.dayOffset === 0 ? '' : '?dates=' + dateKey(d));
    $('matches').innerHTML = loadingHTML('Cargando partidos…');
    return loadWithCache(key, url).then(function (res) {
      state.scoreboard = { key: key, data: res.data };
      (res.data.events || []).forEach(function (e) {
        var s = sidesOf(e);
        rememberTeams([s.home, s.away].filter(Boolean));
      });
      renderMatches();
      updateHeader();
      scheduleRefresh();
    }).catch(function () {
      $('matches').innerHTML = errorHTML('No se pudieron cargar los partidos.');
    });
  }

  function parseEvent(e) {
    var s = sidesOf(e);
    var st = (e.status && e.status.type) || {};
    var clock = (e.status && e.status.displayClock) || (s.comp.status && s.comp.status.displayClock) || '';
    var goals = (s.comp.details || []).filter(function (x) { return x.scoringPlay; }).map(function (x) {
      return {
        teamId: x.team && x.team.id,
        minute: (x.clock && x.clock.displayValue) || '',
        scorer: ((x.athletesInvolved || [])[0] || {}).displayName || '',
        type: (x.type && x.type.text) || ''
      };
    });
    return {
      id: e.id, date: e.date, home: s.home || {}, away: s.away || {},
      state: st.state || 'pre', clock: clock,
      shortDetail: st.shortDetail || '', goals: goals
    };
  }

  function statusPill(p) {
    if (p.state === 'in') return '<span class="status-pill in"><span class="pulse"></span> ' + esc(p.clock || p.shortDetail || 'EN VIVO') + '</span>';
    if (p.state === 'post') return '<span class="status-pill post">Final</span>';
    var d = new Date(p.date);
    var sameDay = dateKey(d) === dateKey(new Date());
    return '<span class="status-pill pre">' + esc(sameDay ? fmtTime(d) : fmtDate(d) + ' ' + fmtTime(d)) + '</span>';
  }

  function renderMatches() {
    var sb = state.scoreboard;
    $('dayLabel').textContent = state.dayOffset === 0 ? 'Hoy · ' + fmtDate(new Date()) : fmtDate(dayForOffset(state.dayOffset));
    $('todayBtn').classList.toggle('hidden', state.dayOffset === 0);

    var box = $('matches');
    if (!sb || !sb.data) { box.innerHTML = errorHTML('Sin datos.'); return; }
    var events = (sb.data.events || []).map(parseEvent);
    var rank = { in: 0, pre: 1, post: 2 };
    events.sort(function (a, b) {
      var r = rank[a.state] - rank[b.state];
      return r !== 0 ? r : new Date(a.date) - new Date(b.date);
    });

    if (!events.length) {
      box.innerHTML = '<div class="empty">No hay partidos de Liga MX este día.</div>';
      return;
    }

    box.innerHTML = events.map(function (p) {
      var hs = num(p.home.score), as = num(p.away.score);
      var hw = p.state === 'post' && hs > as, aw = p.state === 'post' && as > hs;
      var scorers = p.goals.length ? '<div class="match-scorers">' + p.goals.map(function (g) {
        var ti = infoOf(g.teamId);
        return esc(g.minute) + ' ' + esc(g.scorer) +
          (g.type && !/^goal$/i.test(g.type) ? ' (' + esc(g.type) + ')' : '') +
          (ti.abbr ? ' <span style="opacity:.7">· ' + esc(ti.abbr) + '</span>' : '');
      }).join('<br>') + '</div>' : '';
      function teamRow(side, winner) {
        var t = side.team || {};
        return '<div class="team-row' + (winner ? ' winner' : '') + '">' + logoImg(t) +
          '<span class="tname">' + esc(t.displayName || t.name || '') + '</span>' +
          '<span class="score">' + (p.state === 'pre' ? '–' : esc(side.score)) + '</span></div>';
      }
      return '<article class="match-card' + (p.state === 'in' ? ' is-live' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="match-top">' + statusPill(p) + '<span class="comp-name">Liga MX</span></div>' +
        teamRow(p.home, hw) + teamRow(p.away, aw) + scorers + '</article>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('.match-card'), function (card) {
      card.addEventListener('click', function () { openDetail(card.getAttribute('data-id')); });
    });
  }

  $('prevDay').addEventListener('click', function () { state.dayOffset--; loadScoreboard(); });
  $('nextDay').addEventListener('click', function () { state.dayOffset++; loadScoreboard(); });
  $('todayBtn').addEventListener('click', function () { state.dayOffset = 0; loadScoreboard(); });

  /* ---------------- TABLA ---------------- */
  function renderStandings() {
    var S = state.season, box = $('standings');
    if (!S || !S.table.length) { box.innerHTML = '<div class="empty">Tabla no disponible por ahora.</div>'; return; }
    var rows = S.table.map(function (r) {
      var info = infoOf(r.id);
      var dots = r.form.length ? '<span class="form-dots">' + r.form.map(function (f) {
        return '<i class="' + esc(f) + '"></i>';
      }).join('') + '</span>' : '<span style="color:var(--muted)">–</span>';
      var zone = r.pos <= 6 ? 'zone-direct' : (r.pos <= 10 ? 'zone-playin' : '');
      return '<tr class="' + zone + '">' +
        '<td class="pos">' + r.pos + '</td>' +
        '<td class="team-cell"><span class="t">' +
          (info.logo ? '<img src="' + esc(info.logo) + '" alt="" loading="lazy">' : '') +
          esc(info.short || info.name || '') + '</span></td>' +
        '<td>' + r.pj + '</td><td>' + r.g + '</td><td>' + r.e + '</td><td>' + r.p + '</td>' +
        '<td>' + r.gf + '</td><td>' + r.gc + '</td><td>' + (r.dif > 0 ? '+' : '') + r.dif + '</td>' +
        '<td class="pts">' + r.pts + '</td><td>' + dots + '</td></tr>';
    }).join('');
    box.innerHTML = '<div class="table-wrap"><table class="standings">' +
      '<thead><tr><th class="pos">#</th><th class="team-cell">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th>' +
      '<th>GF</th><th>GC</th><th>DIF</th><th>PTS</th><th>Forma</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------------- GOLEADORES ---------------- */
  var leadBtns = Array.prototype.slice.call(document.querySelectorAll('.lead-btn'));
  leadBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.leaderKind = btn.getAttribute('data-lead');
      leadBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      renderLeaders();
    });
  });

  function renderLeaders() {
    var S = state.season, box = $('leaders');
    if (!S) return;
    var html = '';
    if (state.leaderKind === 'goles') {
      var rows = S.scorers.slice(0, 20);
      if (!rows.length) { box.innerHTML = '<div class="empty">Aún no hay goles registrados.</div>'; return; }
      html = rows.map(function (r, i) {
        var info = infoOf(r.teamId);
        return '<div class="leader-row' + (i < 3 ? ' top3' : '') + '">' +
          '<span class="leader-rank">' + (i + 1) + '</span>' +
          '<div class="leader-info"><div class="lname">' + esc(r.name) + '</div>' +
          '<div class="lteam">' + (info.logo ? '<img src="' + esc(info.logo) + '" alt="" loading="lazy">' : '') +
          esc(info.abbr || info.short || '') + '</div></div>' +
          '<div class="leader-stat">' + r.goals + '<small>goles</small></div></div>';
      }).join('');
    } else {
      var cs = S.cleanSheets.slice(0, 10);
      if (!cs.length) { box.innerHTML = '<div class="empty">Sin datos por ahora.</div>'; return; }
      html = cs.map(function (r, i) {
        var info = infoOf(r.teamId);
        return '<div class="leader-row' + (i < 3 ? ' top3' : '') + '">' +
          '<span class="leader-rank">' + (i + 1) + '</span>' +
          '<div class="leader-info"><div class="lname">' + esc(info.name || '') + '</div>' +
          '<div class="lteam">' + (info.logo ? '<img src="' + esc(info.logo) + '" alt="" loading="lazy">' : '') +
          esc(info.abbr || info.short || '') + '</div></div>' +
          '<div class="leader-stat">' + r.n + '<small>vallas<br>invictas</small></div></div>';
      }).join('');
    }
    box.innerHTML = html;
  }

  /* ---------------- EQUIPOS ---------------- */
  function renderTeams() {
    var S = state.season, box = $('teams');
    if (!S || !S.table.length) { box.innerHTML = '<div class="empty">Sin datos de equipos.</div>'; return; }
    box.innerHTML = S.table.map(function (r) {
      var info = infoOf(r.id);
      var dots = r.form.length ? '<span class="form-dots">' + r.form.map(function (f) {
        return '<i class="' + esc(f) + '"></i>';
      }).join('') + '</span>' : '';
      return '<div class="team-card">' +
        (info.logo ? '<img src="' + esc(info.logo) + '" alt="' + esc(info.name || '') + '" loading="lazy">' : '') +
        '<h3>' + esc(info.name || '') + '</h3>' +
        '<div class="record">' + r.g + 'G · ' + r.e + 'E · ' + r.p + 'P</div>' +
        '<div class="gfga">GF ' + r.gf + ' · GC ' + r.gc + ' · ' + r.pts + ' pts</div>' +
        '<div style="margin-top:6px">' + dots + '</div></div>';
    }).join('');
  }

  /* ---------------- DETALLE DEL PARTIDO ---------------- */
  var STAT_LABELS = {
    possessionPct: 'Posesión %', totalShots: 'Tiros', shotsOnTarget: 'Tiros a puerta',
    shotsOffTarget: 'Tiros desviados', blockedShots: 'Tiros bloqueados',
    wonCorners: 'Tiros de esquina', cornerKicks: 'Tiros de esquina',
    foulsCommitted: 'Faltas cometidas', foulsSuffered: 'Faltas recibidas',
    offsides: 'Fueras de juego', saves: 'Atajadas',
    yellowCards: 'Amarillas', redCards: 'Rojas',
    totalPasses: 'Pases', accuratePasses: 'Pases precisos', passPct: 'Precisión de pase %',
    totalCrosses: 'Centros', accurateCrosses: 'Centros precisos',
    totalTackles: 'Entradas', wonTackles: 'Entradas ganadas',
    totalDuels: 'Duelos', wonDuels: 'Duelos ganados',
    totalClearances: 'Despejes', totalInterceptions: 'Intercepciones',
    goalDifference: 'Diferencia de goles', totalGoals: 'Goles', goalAssists: 'Asistencias',
    goalsConceded: 'Goles recibidos'
  };
  function statLabel(name) {
    if (STAT_LABELS[name]) return STAT_LABELS[name];
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function openDetail(eventId) {
    var modal = $('modal'), body = $('modalBody');
    modal.classList.remove('hidden');
    body.innerHTML = loadingHTML('Cargando detalle…');
    document.body.style.overflow = 'hidden';
    loadWithCache('sum_' + eventId, ESPN + '/summary?event=' + eventId).then(function (res) {
      body.innerHTML = renderDetail(res.data);
    }).catch(function () {
      body.innerHTML = errorHTML('No se pudo cargar el detalle.');
    });
  }
  function closeDetail() {
    $('modal').classList.add('hidden');
    document.body.style.overflow = '';
  }
  $('modalClose').addEventListener('click', closeDetail);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeDetail(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  function renderDetail(d) {
    var comp = (((d.header || {}).competitions || [])[0]) || {};
    var s = sidesOf({ competitions: [comp] });
    var home = s.home || {}, away = s.away || {};
    var st = ((d.header || {}).statusType) || (comp.status && comp.status.type) || {};
    var isLive = st.state === 'in';
    var clock = (comp.status && comp.status.displayClock) || '';
    var statusTxt = isLive ? ('En vivo · ' + clock)
      : (st.state === 'post' ? 'Final' : fmtDate(new Date(comp.date)) + ' · ' + fmtTime(new Date(comp.date)));

    var details = comp.details || [];
    var goals = details.filter(function (x) { return x.scoringPlay; });
    var cards = details.filter(function (x) { return x.redCard || x.yellowCard; });

    function teamTag(g) {
      var ti = infoOf(g.team && g.team.id);
      if (ti.abbr) return ti.abbr;
      var isH = g.team && home.team && g.team.id === home.team.id;
      return isH ? 'LOC' : 'VIS';
    }
    var goalsHTML = goals.length ? '<div class="detail-section"><h3>Goles</h3>' + goals.map(function (g) {
      var tp = (g.type && g.type.text) || '';
      return '<div class="goal-row"><span class="goal-min">' + esc((g.clock && g.clock.displayValue) || '') + '</span>' +
        '<span>⚽ ' + esc(((g.athletesInvolved || [])[0] || {}).displayName || '') +
        (tp && !/^goal$/i.test(tp) ? ' <span style="color:var(--muted)">(' + esc(tp) + ')</span>' : '') + '</span>' +
        '<span class="g-team">' + esc(teamTag(g)) + '</span></div>';
    }).join('') + '</div>' : '';

    var cardsHTML = cards.length ? '<div class="detail-section"><h3>Tarjetas</h3>' + cards.map(function (c) {
      return '<div class="goal-row"><span class="goal-min">' + esc((c.clock && c.clock.displayValue) || '') + '</span>' +
        '<span class="card-icon">' + (c.redCard ? '🟥' : '🟨') + ' ' +
        esc(((c.athletesInvolved || [])[0] || {}).displayName || '') + '</span>' +
        '<span class="g-team">' + esc(teamTag(c)) + '</span></div>';
    }).join('') + '</div>' : '';

    var bsTeams = ((d.boxscore || {}).teams || []);
    var bsHome = bsTeams.filter(function (t) { return home.team && t.team && t.team.id === home.team.id; })[0] || bsTeams[0] || {};
    var bsAway = bsTeams.filter(function (t) { return away.team && t.team && t.team.id === away.team.id; })[0] || bsTeams[1] || {};
    var statsHTML = '';
    if ((bsHome.statistics || []).length && (bsAway.statistics || []).length) {
      var mapA = {};
      (bsAway.statistics || []).forEach(function (x) { mapA[x.name] = x.displayValue; });
      var rows = (bsHome.statistics || []).map(function (x) {
        var hv = x.displayValue, av = mapA[x.name];
        if (hv == null || av == null) return '';
        var hn = num(hv), an = num(av);
        var label = '<div class="stat-bar-label"><span class="sl-h">' + esc(hv) +
          '</span><span class="sl-name">' + esc(statLabel(x.name)) + '</span><span class="sl-a">' + esc(av) + '</span></div>';
        if (!isFinite(hn) || !isFinite(an) || (hn === 0 && an === 0 && String(hv) !== '0')) return '<div class="stat-bar-row">' + label + '</div>';
        var total = hn + an, hp = total ? Math.round(hn / total * 100) : 50;
        return '<div class="stat-bar-row">' + label +
          '<div class="stat-bars"><div class="bar h"><i style="width:' + hp + '%"></i></div>' +
          '<div class="bar a"><i style="width:' + (100 - hp) + '%"></i></div></div></div>';
      }).join('');
      if (rows) statsHTML = '<div class="detail-section"><h3>Estadísticas</h3>' + rows + '</div>';
    }

    var venue = comp.venue ? '<div class="detail-meta">' + esc(comp.venue.fullName || '') +
      (comp.venue.address && comp.venue.address.city ? ' · ' + esc(comp.venue.address.city) : '') + '</div>' : '';

    return '<div class="detail-head"><div class="d-status">' +
      (isLive ? '<span class="status-pill in"><span class="pulse"></span> ' + esc(clock || 'EN VIVO') + '</span>'
              : '<span class="status-pill ' + (st.state === 'post' ? 'post' : 'pre') + '">' + esc(statusTxt) + '</span>') +
      '</div><div class="detail-teams">' +
      '<div class="detail-team">' + logoImg(home.team) + '<span class="dt-name">' + esc((home.team || {}).displayName || '') + '</span></div>' +
      '<div class="detail-score">' + esc(home.score == null ? '–' : home.score) + ' – ' + esc(away.score == null ? '–' : away.score) + '</div>' +
      '<div class="detail-team">' + logoImg(away.team) + '<span class="dt-name">' + esc((away.team || {}).displayName || '') + '</span></div>' +
      '</div>' + venue + '</div>' + goalsHTML + cardsHTML + statsHTML;
  }

  /* ---------------- header / refresh ---------------- */
  function updateHeader() {
    var anyLive = false, latest = 0;
    if (state.scoreboard && state.scoreboard.data) {
      (state.scoreboard.data.events || []).forEach(function (e) {
        if (e.status && e.status.type && e.status.type.state === 'in') anyLive = true;
      });
      latest = state.lastOk[state.scoreboard.key] || 0;
    }
    if (state.lastOk.season && state.lastOk.season > latest) latest = state.lastOk.season;
    $('liveBadge').classList.toggle('hidden', !anyLive);
    $('updatedAt').textContent = latest ? 'Actualizado ' + fmtTime(new Date(latest)) : '';
  }

  function loadCurrentTab(force) {
    if (state.tab === 'partidos') return loadScoreboard(force);
    if (state.tab === 'tabla') {
      return ensureSeason('standings', 'Calculando tabla…').then(renderStandings).catch(function () {});
    }
    if (state.tab === 'goleadores') {
      return ensureSeason('leaders', 'Calculando goleadores…').then(renderLeaders).catch(function () {});
    }
    if (state.tab === 'equipos') {
      return ensureSeason('teams', 'Cargando equipos…').then(renderTeams).catch(function () {});
    }
    return Promise.resolve();
  }

  function scheduleRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (document.hidden) return;
      loadCurrentTab(true).then(updateHeader);
    }, 30000);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) loadCurrentTab(true).then(updateHeader);
  });

  /* ---------------- init ---------------- */
  dbg('Liga MX Tracker init', new Date().toISOString());
  loadScoreboard();
  loadSeason().then(updateHeader).catch(function () {});
})();
