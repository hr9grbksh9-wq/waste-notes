// Waste Notes: crew phone + office screens. Hash routing, no framework.
import { kvGet, kvSet, jobGet, jobPut, jobAll, jobDel, regPut, regAll, regDel, persist } from './db.js';
import { encodePack, decodePack, extractPack } from './pack.js';
import { sealRecord, verifySeal, shortPrint } from './seal.js';
import { SignaturePad, readPhoto, getLocation } from './sign.js';
import {
  TRANSFEROR_TYPES, CONTAINERS, SECTIONS, NATION_LABEL, nationFromPostcode, regimeFor, premisesOf,
  streamsFromItems, itemById, loadLines, lineTotals, streamTotals, deskChecks, blocking, loadChecks,
  vehicleCapacity, signedStreamKeys, honestyFlags, codeFor, descriptionFor, quantityText, hazardousFor, availableFor, streamKey, lineQuantity,
} from './rules.js';
import { buildJobNote, renderNotePdf } from './notes.js';
import { zohoImportFiles } from './zoho.js';

const APP_VERSION = '0.1.4';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = () => $('#view');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const nowIso = () => new Date().toISOString();
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : '');
const num = (v) => Number(v || 0).toLocaleString('en-GB');

const state = { settings: null, mode: null };

// ---------------- Boot ----------------
async function boot() {
  state.settings = (await kvGet('settings')) || null;
  state.mode = (await kvGet('mode')) || null;
  applyBrand();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // first install, nothing to refresh
      if (/\/(load|close|sign|hazard)\b/.test(location.hash)) toast('A new version is ready. It loads next time you open the app.');
      else location.reload();
    });
  }
  persist();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();
  await route();
}

function updateNet() {
  const el = $('#net');
  if (el) { el.textContent = navigator.onLine ? 'Online' : 'No signal: working offline'; el.className = navigator.onLine ? 'net on' : 'net off'; }
}

function applyBrand() {
  const b = state.settings?.company?.brand || {};
  document.documentElement.style.setProperty('--primary', b.primary || '#404446');
  document.documentElement.style.setProperty('--accent', b.accent || '#DDBD5A');
  $('#brand').textContent = state.settings?.company?.display_name || state.settings?.company?.trading_name || state.settings?.company?.legal_name || 'Waste Notes';
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  const hash = location.hash || '#/';
  // Incoming links: #pack=... (a job) or #setup=... (settings for this device)
  const incoming = extractPack(hash);
  if (incoming && (incoming.kind === 'pack' || incoming.kind === 'setup')) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    return importPack(incoming);
  }
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const query = new URLSearchParams(hash.split('?')[1] || '');
  window.scrollTo(0, 0);
  try {
    if (!state.settings && parts[0] !== 'help') return viewSetup();
    if (parts[0] === 'crew') {
      if (!parts[1]) return viewCrewJobs();
      const job = await jobGet(parts[2]);
      if (!job) { toast('That job is not on this phone.'); return go('#/crew'); }
      const sub = parts[3];
      if (!sub) return viewCrewJob(job);
      if (sub === 'sign') return viewSignoff(job, query.get('add') === '1');
      if (sub === 'load') return viewTally(job, parts[4]);
      if (sub === 'close') return viewCloseLoad(job, parts[4]);
      if (sub === 'gate') return viewGate(job, parts[4]);
      if (sub === 'hazard') return viewHazard(job, query.get('item'));
      if (sub === 'finish') return viewFinish(job);
      if (sub === 'note') return viewNote(job, decodeURIComponent(parts[4] || ''), query.get('just') === '1');
    }
    if (parts[0] === 'office') {
      if (parts[1] === 'new') return viewJobForm(null);
      if (parts[1] === 'edit') return viewJobForm(await jobGet(parts[2]));
      if (parts[1] === 'sent') return viewJobSent(await jobGet(parts[2]));
      if (parts[1] === 'register') return viewRegister(query.get('note'));
      if (parts[1] === 'note') return viewRegisterNote(decodeURIComponent(parts[2] || ''));
      if (parts[1] === 'settings') return viewSettings();
      return viewOfficeJobs();
    }
    if (parts[0] === 'help') return viewHelp();
    return state.mode === 'office' ? viewOfficeJobs() : viewCrewJobs();
  } catch (err) {
    console.error(err);
    view().innerHTML = `<div class="card bad"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Back to start</a></div>`;
  }
}

function nav(active) {
  const crew = state.mode !== 'office';
  const tabs = crew
    ? [['#/crew', 'Jobs', 'jobs']]
    : [['#/office', 'Jobs', 'jobs'], ['#/office/new', 'New job', 'new'], ['#/office/register', 'Register', 'register'], ['#/office/settings', 'Settings', 'settings']];
  return `<nav class="tabs">${tabs.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

// ---------------- Setup ----------------
function viewSetup() {
  view().innerHTML = `
  <div class="card">
    <h1>Set up this device</h1>
    <p>This app makes waste transfer notes from a count of what goes on the van. It works with no signal once it is set up.</p>
    <h3>From the office</h3>
    <p class="muted">Open the setup link the office sent you, or paste it here.</p>
    <textarea id="setupLink" rows="3" placeholder="Paste the setup link"></textarea>
    <button class="btn primary" id="useLink">Use this link</button>
    <h3>Or load a settings file</h3>
    <input type="file" id="setupFile" accept="application/json,.json">
    <h3>Just trying it?</h3>
    <button class="btn" id="example">Use example settings (made-up company)</button>
  </div>
  <p class="muted small">Version ${APP_VERSION}. <a href="#/help">What this app does</a></p>`;
  $('#useLink').onclick = async () => {
    const p = extractPack($('#setupLink').value);
    if (!p) return toast('That does not look like a setup link.', 'bad');
    importPack({ kind: 'setup', data: p.data });
  };
  $('#setupFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await saveSettings(JSON.parse(await f.text())); } catch (err) { toast(`Could not read that file: ${err.message}`, 'bad'); }
  };
  $('#example').onclick = async () => {
    const res = await fetch('./settings.example.json');
    await saveSettings(await res.json());
  };
}

async function saveSettings(settings) {
  if (!settings?.company || !Array.isArray(settings.items)) throw new Error('Not a settings file for this app');
  state.settings = settings;
  await kvSet('settings', settings);
  applyBrand();
  toast(`Settings loaded: ${settings.items.length} items, list ${settings.items_version || ''}`, 'ok');
  if (!state.mode) return viewChooseMode();
  go(state.mode === 'office' ? '#/office' : '#/crew');
}

function viewChooseMode() {
  view().innerHTML = `
  <div class="card">
    <h1>Who is using this device?</h1>
    <button class="btn primary big" data-mode="crew">Crew lead's phone</button>
    <button class="btn big" data-mode="office">Office (sets up jobs, keeps the register)</button>
    <p class="muted small">You can switch later from Settings.</p>
  </div>`;
  $$('[data-mode]').forEach((b) => (b.onclick = async () => {
    state.mode = b.dataset.mode;
    await kvSet('mode', state.mode);
    go(state.mode === 'office' ? '#/office' : '#/crew');
  }));
}

async function importPack({ kind, data }) {
  try {
    const obj = await decodePack(data);
    if (kind === 'setup' || obj.kind === 'setup') {
      await saveSettings(obj.settings || obj);
      return;
    }
    if (!state.settings) { toast('Set this phone up first, then open the job link again.', 'bad'); return viewSetup(); }
    const incoming = obj.job;
    const existing = await jobGet(incoming.id);
    if (existing?.crew?.started) {
      // Keep crew progress; refresh the office details only.
      await jobPut({ ...existing, ...incoming, crew: existing.crew, loads: existing.loads, signoff: existing.signoff, addenda: existing.addenda, hazards: existing.hazards, notes: existing.notes });
      toast('Job updated from the office. Your counts are kept.', 'ok');
    } else {
      await jobPut({ ...incoming, crew: { received_at: nowIso() }, loads: [], hazards: [], addenda: [], notes: [] });
      toast(`Job ${incoming.ref} added to this phone.`, 'ok');
    }
    if (!state.mode) { state.mode = 'crew'; await kvSet('mode', 'crew'); }
    go(`#/crew/job/${incoming.id}`);
  } catch (err) {
    toast(`Could not open that link: ${err.message}`, 'bad');
    go('#/');
  }
}

// ---------------- Crew: jobs ----------------
function jobStatus(job) {
  if ((job.notes || []).length) return { text: `Note made: ${job.notes[job.notes.length - 1].number}`, cls: 'ok' };
  const open = (job.loads || []).find((l) => !l.closed_at);
  if (open) return { text: `Loading: ${open.ref}`, cls: 'warn' };
  if ((job.loads || []).length) return { text: `${job.loads.length} load(s) closed`, cls: 'warn' };
  if (job.signoff) return { text: 'Description signed', cls: 'warn' };
  return { text: 'Not started', cls: '' };
}

async function viewCrewJobs() {
  const jobs = (await jobAll()).filter((j) => j.crew).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  view().innerHTML = `${nav('jobs')}
  <div class="row"><h1>Jobs on this phone</h1></div>
  ${jobs.length ? jobs.map((j) => {
    const s = jobStatus(j);
    return `<a class="card link" href="#/crew/job/${j.id}">
      <div class="row"><strong>${esc(j.ref)}</strong><span class="pill ${s.cls}">${esc(s.text)}</span></div>
      <div>${esc(j.producer?.name || j.signatory?.name || '')}</div>
      <div class="muted">${esc(j.collection?.postcode || '')} · ${fmtDate(j.date)} · ${esc(NATION_LABEL[j.nation] || '')}</div></a>`;
  }).join('') : '<div class="card"><p>No jobs yet. Open the job link the office sends you.</p></div>'}
  <details class="card"><summary>Add a job from a link</summary>
    <textarea id="packLink" rows="3" placeholder="Paste the job link"></textarea>
    <button class="btn primary" id="addPack">Add job</button>
  </details>
  ${await backupCard(jobs.length)}
  <p class="muted small">${esc(state.settings.company.legal_name)} · item list ${esc(state.settings.items_version || '')} · <a href="#/office/settings">Settings</a> · <a href="#/help">Help</a></p>`;
  const unsent = unsentOffice(jobs);
  if (unsent.length) {
    const tabs = $('.tabs');
    (tabs || view()).insertAdjacentHTML(tabs ? 'afterend' : 'afterbegin', `<div class="card danger-card"><h2>Office copy not sent</h2><p>These notes only exist on this phone until the office copy is sent.</p>
      ${unsent.map(({ job: j, note: n }) => `<a class="btn" href="#/crew/job/${j.id}/note/${encodeURIComponent(n.number)}">${esc(n.number)}</a>`).join('')}</div>`);
  }
  bindBackup();
  $('#addPack').onclick = () => {
    const p = extractPack($('#packLink').value);
    if (!p) return toast('That does not look like a job link.', 'bad');
    importPack({ kind: 'pack', data: p.data });
  };
}

function siteName(id) { return (state.settings.sites || []).find((s) => s.id === id)?.name || id; }

async function viewCrewJob(job) {
  const s = jobStatus(job);
  const openLoad = (job.loads || []).find((l) => !l.closed_at);
  const closed = (job.loads || []).filter((l) => l.closed_at);
  const unnoted = closed.filter((l) => !(job.notes || []).some((n) => (n.load_refs || []).includes(l.ref)));
  const regime = regimeFor(job.nation);
  view().innerHTML = `${nav('jobs')}
  <div class="card">
    <div class="row"><h1>${esc(job.ref)}</h1><span class="pill ${s.cls}">${esc(s.text)}</span></div>
    <div><strong>${esc(job.producer?.name || job.signatory?.name || '')}</strong></div>
    <div class="muted">${esc(job.collection?.address || '')}, ${esc(job.collection?.postcode || '')}</div>
    <div class="muted">${fmtDate(job.date)} · ${esc(NATION_LABEL[job.nation] || '')}${regime === 'SC' ? ' · client signs every load' : ''}${job.photos_allowed === false ? ' · <strong>no photos on this site</strong>' : ''}</div>
    <div class="muted">Signs for the client: ${esc(job.signatory?.name || '')}${job.signatory?.role ? `, ${esc(job.signatory.role)}` : ''}</div>
    <div class="muted">Tip sites: ${esc((job.planned_sites || []).map(siteName).join(', '))}</div>
  </div>

  <div class="card step ${job.signoff ? 'done' : ''}">
    <h2>1. Client signs the waste description</h2>
    ${job.signoff
      ? `<p>Signed by <strong>${esc(job.signoff.client_name)}</strong> at ${fmtTime(job.signoff.signed_at)}. Sealed ${esc(shortPrint(job.signoff.seal?.fingerprint))}.</p>
         ${(job.addenda || []).map((a) => `<p class="muted small">Addition signed ${fmtTime(a.signed_at)}: ${esc(a.streams.map((x) => x.code).join(', '))}</p>`).join('')}`
      : `<p>Before the first load leaves, the client's named person signs what is being taken. Every load is then logged against it.</p>
         <a class="btn primary big" href="#/crew/job/${job.id}/sign">Client signs now</a>`}
  </div>

  <div class="card step">
    <h2>2. Loads</h2>
    ${(job.loads || []).map((l) => {
      const lines = loadLines(l, itemById(state.settings), premisesOf(job));
      const t = lineTotals(lines, itemById(state.settings));
      return `<div class="load ${l.closed_at ? 'closed' : 'open'}">
        <div class="row"><strong>${esc(l.ref)}</strong><span class="pill ${l.closed_at ? 'ok' : 'warn'}">${l.closed_at ? `Left ${fmtTime(l.closed_at)}` : 'Loading'}</span></div>
        <div class="muted">${esc(l.vehicle_reg || 'vehicle?')} → ${esc(siteName(l.destination_id) || 'destination?')} · ${num(t.count)} items · ~${num(t.kg)} kg · ${num(t.cuft)} cu ft</div>
        <div class="btnrow">
          ${l.closed_at
            ? `<a class="btn" href="#/crew/job/${job.id}/gate/${encodeURIComponent(l.ref)}">Gate slip${l.tip?.ticket_no ? ' ✓' : ''}</a>`
            : `<a class="btn primary" href="#/crew/job/${job.id}/load/${encodeURIComponent(l.ref)}">Carry on counting</a>`}
        </div></div>`;
    }).join('') || '<p class="muted">No loads yet.</p>'}
    ${openLoad ? '' : `<button class="btn primary big" id="startLoad">Start a load</button>`}
  </div>

  <div class="card">
    <a class="btn danger big" href="#/crew/job/${job.id}/hazard">Found hazardous / not sure</a>
    ${(job.hazards || []).length ? `<p class="muted small">${job.hazards.length} item(s) left on site: ${esc(job.hazards.map((h) => `${h.count || 1} × ${h.type}`).join(', '))}</p>` : ''}
  </div>

  <div class="card step">
    <h2>3. Finish and send the note</h2>
    ${(job.notes || []).map((n) => `<div class="note-row"><strong>${esc(n.number)}</strong> <span class="muted">${fmtTime(n.issued_at)} · sealed ${esc(shortPrint(n.fingerprint))}</span>
      <div>${n.sent?.office ? `<span class="pill ok">Office copy ${esc(sentText(n.sent.office))}</span>` : '<span class="pill bad">Office copy not sent</span>'} ${n.sent?.client ? `<span class="pill ok">Client ${esc(sentText(n.sent.client))}</span>` : '<span class="pill">Client not sent</span>'}</div>
      <div class="btnrow"><button class="btn" data-share-client="${esc(n.number)}">Send to client</button><button class="btn" data-share-office="${esc(n.number)}">Send to office</button><a class="btn" href="#/crew/job/${job.id}/note/${encodeURIComponent(n.number)}">View</a></div></div>`).join('')}
    ${unnoted.length && !openLoad
      ? `<a class="btn primary big" href="#/crew/job/${job.id}/finish">Finish: make the note (${unnoted.length} load${unnoted.length > 1 ? 's' : ''})</a>`
      : `<p class="muted">${openLoad ? 'Close the open load first.' : (job.notes || []).length ? 'All loads are on a note.' : 'Close at least one load first.'}</p>`}
  </div>
  <p class="muted small"><a href="#/crew">All jobs</a></p>`;

  const start = $('#startLoad');
  if (start) start.onclick = async () => {
    const used = new Set((job.loads || []).map((l) => l.ref));
    const ref = (job.load_refs || []).find((r) => !used.has(r)) || `${job.ref_prefix || 'LD'}-${job.ref}-L${(job.loads || []).length + 1}`;
    const prev = (job.loads || [])[job.loads.length - 1];
    const crewName = await kvGet('crew_name');
    job.loads = [...(job.loads || []), {
      ref, started_at: nowIso(), vehicle_reg: prev?.vehicle_reg || '', vehicle_type: prev?.vehicle_type || '',
      driver: prev?.driver || crewName || '', destination_id: prev?.destination_id || (job.planned_sites || [])[0] || '',
      counts: {}, reuse: {}, unlisted: [], containers: {}, tally_times: [],
    }];
    job.crew = { ...(job.crew || {}), started: true };
    await jobPut(job);
    go(`#/crew/job/${job.id}/load/${encodeURIComponent(ref)}`);
  };
  $$('[data-share-client]').forEach((b) => (b.onclick = () => shareNote(job, b.dataset.shareClient, 'client')));
  $$('[data-share-office]').forEach((b) => (b.onclick = () => shareNote(job, b.dataset.shareOffice, 'office')));
}

// ---------------- Crew: sign-off ----------------
function streamsForJob(job) {
  const all = streamsFromItems(state.settings.items, premisesOf(job));
  const want = new Set(job.expected_streams || []);
  return all.filter((s) => want.has(s.key));
}

async function viewSignoff(job, addendum) {
  const regime = regimeFor(job.nation);
  // Regulation 12 (waste hierarchy) is a business duty: householders are not asked.
  const askHierarchy = regime === 'EW' && TRANSFEROR_TYPES[job.transferor_type]?.needsNote !== false;
  let streams;
  if (addendum) {
    const signed = new Set(signedStreamKeys(job));
    const open = (job.loads || []).find((l) => !l.closed_at) || (job.loads || [])[job.loads.length - 1];
    const lines = open ? loadLines(open, itemById(state.settings), premisesOf(job)) : [];
    const all = streamsFromItems(state.settings.items, premisesOf(job));
    const keys = new Set(lines.map((l) => l.stream_key).filter((k) => k && !signed.has(k)));
    streams = all.filter((s) => keys.has(s.key));
    if (!streams.length) { toast('Nothing new needs signing.'); return go(`#/crew/job/${job.id}`); }
  } else {
    streams = streamsForJob(job);
  }
  const survey = job.survey_counts && Object.keys(job.survey_counts).length ? lineTotals(Object.entries(job.survey_counts).map(([item_id, count]) => ({ item_id, count })), itemById(state.settings)) : null;
  const crewName = (await kvGet('crew_name')) || '';
  view().innerHTML = `
  <div class="card">
    <h1>${addendum ? 'Client signs an addition' : 'Client signs the waste description'}</h1>
    <p>Hand the phone to <strong>${esc(job.signatory?.name || 'the client')}</strong>. They are signing for the waste below${addendum ? ', which was not on the description they signed earlier' : ''}.</p>
    <table class="streams"><thead><tr><th>Code</th><th>Waste</th></tr></thead><tbody>
      ${streams.map((s) => `<tr class="${s.pops ? 'pops' : ''}"><td>${esc(s.code)}</td><td>${esc(s.description)}${s.pops ? `<div class="small">POPs: ${esc(s.pops_chemicals || '')}. Kept unmixed, unloaded separately, incinerated.</div>` : ''}<div class="muted small">e.g. ${esc(s.examples.join(', '))}</div></td></tr>`).join('')}
    </tbody></table>
    ${survey && !addendum ? `<p class="muted">From the survey: about ${num(survey.count)} items, ~${num(survey.kg)} kg (estimate). Actual counts are logged load by load.</p>` : ''}
    <div class="kv"><span>From</span><span>${esc(job.producer?.name || '')}, ${esc(job.collection?.address || '')}, ${esc(job.collection?.postcode || '')}</span></div>
    <div class="kv"><span>Taken by</span><span>${esc(state.settings.company.legal_name)} · ${esc(state.settings.company.registration?.authority || '')} ${esc(state.settings.company.registration?.number || '')}</span></div>
  </div>
  <div class="card">
    ${askHierarchy ? `<label class="check"><input type="checkbox" id="hier"> I confirm we have applied the waste hierarchy (reduce, reuse, recycle before disposal), as required by regulation 12 of the Waste (England and Wales) Regulations 2011.</label>` : ''}
    <label class="check"><input type="checkbox" id="acc"> I confirm this describes the waste being handed over${addendum ? '' : ' today, and that each load will be recorded against this note'}.</label>
    <label>Client's name<input id="cname" value="${esc(job.signatory?.name || '')}" autocomplete="off"></label>
    <label>Their role<input id="crole" value="${esc(job.signatory?.role || '')}" autocomplete="off"></label>
    <div class="sigwrap"><canvas id="csig"></canvas><button class="btn small" id="cclear">Clear</button></div>
    <p class="muted small">Client signs above</p>
  </div>
  <div class="card">
    <label>Crew lead's name<input id="kname" value="${esc(crewName)}" autocomplete="off"></label>
    <div class="sigwrap"><canvas id="ksig"></canvas><button class="btn small" id="kclear">Clear</button></div>
    <p class="muted small">Crew lead signs above (for the carrier)</p>
    <button class="btn primary big" id="seal">Sign and seal</button>
    <a class="btn" href="#/crew/job/${job.id}">Cancel</a>
  </div>`;
  const cpad = new SignaturePad($('#csig'));
  const kpad = new SignaturePad($('#ksig'));
  $('#cclear').onclick = () => cpad.clear();
  $('#kclear').onclick = () => kpad.clear();
  $('#seal').onclick = async () => {
    if (askHierarchy && !$('#hier').checked) return toast('The client needs to tick the waste hierarchy box.', 'bad');
    if (!$('#acc').checked) return toast('The client needs to confirm the description.', 'bad');
    if (!$('#cname').value.trim() || cpad.isEmpty) return toast("Client's name and signature are needed.", 'bad');
    if (!$('#kname').value.trim() || kpad.isEmpty) return toast("Crew lead's name and signature are needed.", 'bad');
    $('#seal').disabled = true;
    $('#seal').textContent = 'Sealing…';
    await kvSet('crew_name', $('#kname').value.trim());
    const gps = await getLocation(5000);
    const record = await sealRecord({
      kind: addendum ? 'addendum' : 'signoff', job_id: job.id, job_ref: job.ref,
      streams: streams.map(({ key, code, description, pops, pops_chemicals }) => ({ key, code, description, pops, pops_chemicals: pops_chemicals || null })),
      hierarchy: askHierarchy ? $('#hier').checked : null, accurate: $('#acc').checked,
      client_name: $('#cname').value.trim(), client_role: $('#crole').value.trim(), client_signature: cpad.toJpeg(),
      crew_name: $('#kname').value.trim(), crew_signature: kpad.toJpeg(),
      signed_at: nowIso(), gps, place: job.collection || null, item_list_version: state.settings.items_version || null,
    });
    const fresh = await jobGet(job.id);
    if (addendum) fresh.addenda = [...(fresh.addenda || []), record];
    else fresh.signoff = record;
    fresh.crew = { ...(fresh.crew || {}), started: true };
    await jobPut(fresh);
    toast('Signed and sealed.', 'ok');
    history.back();
  };
}

// ---------------- Crew: tally ----------------
async function viewTally(job, ref) {
  ref = decodeURIComponent(ref);
  const load = (job.loads || []).find((l) => l.ref === ref);
  if (!load) return go(`#/crew/job/${job.id}`);
  if (load.closed_at) return go(`#/crew/job/${job.id}/gate/${encodeURIComponent(ref)}`);
  const premises = premisesOf(job);
  const items = (state.settings.items || []).filter((i) => availableFor(i, premises));
  const byId = itemById(state.settings);
  let mode = 'waste';
  let showAll = false;
  let filter = '';
  const sites = state.settings.sites || [];
  const planned = new Set(job.planned_sites || []);
  const vtypes = state.settings.vehicle_types || [];

  const save = debounce(async () => { const fresh = await jobGet(job.id); fresh.loads = fresh.loads.map((l) => (l.ref === ref ? load : l)); await jobPut(fresh); }, 400);

  const totals = () => {
    const lines = loadLines(load, byId, premises);
    const t = lineTotals(lines, byId);
    const cap = vehicleCapacity(load, state.settings);
    const reuseCount = Object.values(load.reuse || {}).reduce((a, b) => a + b, 0);
    return `<strong>${num(t.count)}</strong> items · ~<strong>${num(t.kg)}</strong> kg · <strong>${num(t.cuft)}</strong>${cap ? ` / ${num(cap)}` : ''} cu ft${reuseCount ? ` · reuse ${reuseCount}` : ''}${cap && t.cuft > cap ? ' <span class="pill bad">over capacity</span>' : ''}`;
  };

  const tile = (it) => {
    const stop = hazardousFor(it, premises);
    const count = mode === 'reuse' ? (load.reuse?.[it.id] || 0) : (load.counts?.[it.id] || 0);
    if (stop) return `<button class="tile stop" data-hazard="${esc(it.id)}"><span class="lbl">${esc(it.label)}</span><span class="small">Do not load: tap to log</span></button>`;
    return `<div class="tile ${it.pops ? 'pops' : ''} ${it.weee ? 'weee' : ''} ${count ? 'has' : ''}" data-id="${esc(it.id)}">
      <button class="minus" data-minus="${esc(it.id)}" aria-label="Take one off: ${esc(it.label)}">−</button>
      <button class="plus" data-plus="${esc(it.id)}" aria-label="Add one: ${esc(it.label)}"><span class="lbl">${esc(it.label)}</span><span class="cnt" data-count="${esc(it.id)}">${count}</span><span class="unit">${it.count_unit && it.count_unit !== 'each' ? `per ${esc(it.count_unit)}` : ''}</span></button>
      <button class="set" data-set="${esc(it.id)}" aria-label="Type a number: ${esc(it.label)}">#</button></div>`;
  };

  const render = () => {
    const f = filter.toLowerCase();
    const visible = items.filter((it) => (f ? `${it.label} ${it.long_name || ''}`.toLowerCase().includes(f) : (showAll || it.common || (load.counts?.[it.id] || load.reuse?.[it.id]))));
    const sectionOf = (it) => (hazardousFor(it, premises) ? 'hazardous_stop' : it.section);
    const sectionsHtml = SECTIONS.map((sec) => {
      const list = visible.filter((it) => sectionOf(it) === sec.id);
      if (!list.length) return '';
      return `<section class="sec ${sec.tone}"><h3>${esc(sec.label)}</h3><div class="tiles">${list.map(tile).join('')}</div></section>`;
    }).join('');
    const siteOpts = [...sites].sort((a, b) => (planned.has(b.id) - planned.has(a.id))).map((s) => `<option value="${esc(s.id)}" ${s.id === load.destination_id ? 'selected' : ''}>${esc(s.name)}${planned.has(s.id) ? ' (planned)' : ''}</option>`).join('');
    view().innerHTML = `
    <div class="sticky">
      <div class="row"><strong>Load ${esc(ref)}</strong><a class="btn small" href="#/crew/job/${job.id}">Job</a></div>
      <div class="totals" id="totals">${totals()}</div>
      <div class="seg"><button class="${mode === 'waste' ? 'on' : ''}" data-mode="waste">Counting waste</button><button class="${mode === 'reuse' ? 'on reuse' : ''}" data-mode="reuse">Counting reuse / donation</button></div>
    </div>
    <details class="card" ${load.vehicle_reg && load.destination_id ? '' : 'open'}><summary>Vehicle and destination</summary>
      <label>Vehicle registration<input id="vreg" value="${esc(load.vehicle_reg)}" autocapitalize="characters" autocomplete="off"></label>
      <label>Vehicle type<select id="vtype"><option value="">Choose</option>${vtypes.map((v) => `<option value="${esc(v.id)}" ${v.id === load.vehicle_type ? 'selected' : ''}>${esc(v.label)} (${num(v.usable_cuft)} cu ft)</option>`).join('')}</select></label>
      <label>Driver<input id="driver" value="${esc(load.driver)}" autocomplete="off"></label>
      <label>Going to<select id="dest"><option value="">Choose the tip site</option>${siteOpts}</select></label>
    </details>
    <input class="search" id="search" placeholder="Find an item" value="${esc(filter)}">
    ${sectionsHtml || '<p class="muted">No items match.</p>'}
    <div class="card">
      <button class="btn" id="toggleAll">${showAll ? 'Show common items only' : 'Show all items'}</button>
      <button class="btn" id="unlisted">Not on the list</button>
      ${(load.unlisted || []).map((u, i) => `<div class="muted small">Not on list: ${esc(u.text)} × ${u.count} <button class="link" data-unl="${i}">remove</button></div>`).join('')}
    </div>
    <div class="bottombar"><a class="btn primary big" href="#/crew/job/${job.id}/close/${encodeURIComponent(ref)}">Close this load</a></div>`;
    bind();
  };

  const bump = (id, delta) => {
    const bag = mode === 'reuse' ? (load.reuse ||= {}) : (load.counts ||= {});
    bag[id] = Math.max(0, (bag[id] || 0) + delta);
    if (!bag[id]) delete bag[id];
    load.tally_times = [...(load.tally_times || []), nowIso()].slice(-500);
    const el = $(`[data-count="${CSS.escape(id)}"]`);
    if (el) { el.textContent = bag[id] || 0; el.closest('.tile')?.classList.toggle('has', !!bag[id]); }
    $('#totals').innerHTML = totals();
    if (navigator.vibrate) navigator.vibrate(12);
    save();
  };

  const bind = () => {
    $$('[data-plus]').forEach((b) => (b.onclick = () => bump(b.dataset.plus, 1)));
    $$('[data-minus]').forEach((b) => (b.onclick = () => bump(b.dataset.minus, -1)));
    $$('[data-set]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.set;
      const bag = mode === 'reuse' ? (load.reuse ||= {}) : (load.counts ||= {});
      const v = prompt(`How many: ${byId.get(id)?.label}?`, bag[id] || 0);
      if (v === null) return;
      const n = Math.max(0, Math.round(Number(v) || 0));
      bump(id, n - (bag[id] || 0));
    }));
    $$('[data-hazard]').forEach((b) => (b.onclick = () => go(`#/crew/job/${job.id}/hazard?item=${encodeURIComponent(b.dataset.hazard)}`)));
    $$('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(); }));
    $('#toggleAll').onclick = () => { showAll = !showAll; render(); };
    $('#search').oninput = debounce((e) => { filter = e.target.value; render(); $('#search').focus(); const s = $('#search'); s.setSelectionRange(s.value.length, s.value.length); }, 250);
    $('#vreg').onchange = (e) => { load.vehicle_reg = e.target.value.trim().toUpperCase(); save(); };
    $('#vtype').onchange = (e) => { load.vehicle_type = e.target.value; $('#totals').innerHTML = totals(); save(); };
    $('#driver').onchange = (e) => { load.driver = e.target.value.trim(); save(); };
    $('#dest').onchange = (e) => { load.destination_id = e.target.value; save(); };
    $('#unlisted').onclick = () => {
      const text = prompt('What is it? (short description)');
      if (!text) return;
      const c = Math.max(1, Math.round(Number(prompt('How many?', '1')) || 1));
      load.unlisted = [...(load.unlisted || []), { text: text.trim(), count: c }];
      save();
      render();
    };
    $$('[data-unl]').forEach((b) => (b.onclick = () => { load.unlisted.splice(Number(b.dataset.unl), 1); save(); render(); }));
  };
  render();
}

// ---------------- Crew: close load ----------------
async function viewCloseLoad(job, ref) {
  ref = decodeURIComponent(ref);
  const load = (job.loads || []).find((l) => l.ref === ref);
  if (!load) return go(`#/crew/job/${job.id}`);
  const byId = itemById(state.settings);
  const lines = loadLines(load, byId, premisesOf(job));
  const t = lineTotals(lines, byId);
  const sectionsPresent = [...new Set(lines.map((l) => l.section))];
  const hasPops = lines.some((l) => l.pops);
  const regime = regimeFor(job.nation);
  const checks = loadChecks(job, load, state.settings, lines);
  view().innerHTML = `
  <div class="card">
    <h1>Close load ${esc(ref)}</h1>
    <p>${num(t.count)} items · ~${num(t.kg)} kg (estimate) · ${num(t.cuft)} cu ft</p>
    <table class="streams"><thead><tr><th>Item</th><th>Code</th><th class="r">Count</th></tr></thead><tbody>
      ${lines.map((l) => `<tr class="${l.pops ? 'pops' : ''}"><td>${esc(l.label)}</td><td>${esc(l.code)}</td><td class="r">${l.count}${l.count_unit && !['each'].includes(l.count_unit) ? ` ${esc(l.count_unit)}` : ''}</td></tr>`).join('')}
    </tbody></table>
    <a class="btn" href="#/crew/job/${job.id}/load/${encodeURIComponent(ref)}">Back to counting</a>
  </div>
  <div class="card">
    <h2>How is it on the van?</h2>
    ${sectionsPresent.map((sec) => {
      const cur = load.containers?.[sec]?.code || (sec === 'seating_pops' ? 'BAG' : 'LOO');
      const label = SECTIONS.find((s) => s.id === sec)?.label || sec;
      return `<label>${esc(label)}<select data-cont="${esc(sec)}">${CONTAINERS.map((c) => `<option value="${c.code}" ${c.code === cur ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`;
    }).join('')}
    ${hasPops ? `<label class="check pops"><input type="checkbox" id="unmixed" ${load.pops_unmixed ? 'checked' : ''}> The upholstered seating is kept unmixed on the van (bagged, caged or in its own section) and will be unloaded separately.</label>` : ''}
    ${job.photos_allowed === false ? '<p class="muted">No photos on this site.</p>' : `<label>Photo of the loaded van (doors open)<input type="file" accept="image/*" capture="environment" id="photo"></label>${load.photo ? '<p class="muted small">Photo taken ✓</p>' : ''}`}
    ${regime === 'SC' ? `<h3>Scotland: client signs for this load</h3><label>Client's name<input id="lcname" value="${esc(job.signatory?.name || '')}"></label><div class="sigwrap"><canvas id="lsig"></canvas><button class="btn small" id="lclear">Clear</button></div>` : ''}
  </div>
  <div class="card">
    <h2>Checks</h2>
    <div id="checks">${renderChecks(checks)}</div>
    ${checks.some((c) => c.rule === 'addendum') ? `<a class="btn primary" href="#/crew/job/${job.id}/sign?add=1">Client signs the addition</a>` : ''}
    ${checks.some((c) => c.rule === 'signoff') ? `<a class="btn primary" href="#/crew/job/${job.id}/sign">Client signs now</a>` : ''}
    <button class="btn primary big" id="close">Close load: van is leaving</button>
  </div>`;

  const save = async () => { const fresh = await jobGet(job.id); fresh.loads = fresh.loads.map((l) => (l.ref === ref ? load : l)); await jobPut(fresh); };
  $$('[data-cont]').forEach((s) => (s.onchange = () => { load.containers = { ...(load.containers || {}), [s.dataset.cont]: CONTAINERS.find((c) => c.code === s.value) }; save(); }));
  // default containers for untouched sections
  load.containers = Object.fromEntries(sectionsPresent.map((sec) => [sec, load.containers?.[sec] || CONTAINERS.find((c) => c.code === (sec === 'seating_pops' ? 'BAG' : 'LOO'))]));
  const unm = $('#unmixed');
  if (unm) unm.onchange = () => { load.pops_unmixed = unm.checked; refresh(); save(); };
  const photo = $('#photo');
  if (photo) photo.onchange = async (e) => { if (!e.target.files[0]) return; load.photo = await readPhoto(e.target.files[0]); save(); toast('Photo saved.', 'ok'); };
  let lpad = null;
  if (regime === 'SC') { lpad = new SignaturePad($('#lsig'), { onChange: () => refresh() }); $('#lclear').onclick = () => lpad.clear(); }
  function refresh() {
    if (lpad) load.client_signature = lpad.isEmpty ? null : { pending: true };
    $('#checks').innerHTML = renderChecks(loadChecks(job, load, state.settings, lines));
  }
  $('#close').onclick = async () => {
    if (lpad && !lpad.isEmpty) load.client_signature = { ...lpad.toJpeg(), name: $('#lcname').value.trim(), at: nowIso() };
    else if (lpad) load.client_signature = null;
    const fresh = await jobGet(job.id);
    const c = loadChecks(fresh, load, state.settings, lines);
    const blocks = c.filter((x) => x.level === 'block');
    if (blocks.length) { $('#checks').innerHTML = renderChecks(c); return toast(blocks[0].msg, 'bad'); }
    const warns = c.filter((x) => x.level === 'warn');
    if (warns.length && !confirm(`Check before closing:\n\n${warns.map((w) => `• ${w.msg}`).join('\n')}\n\nClose the load anyway?`)) return;
    load.closed_at = nowIso();
    load.crew_confirm = { name: (await kvGet('crew_name')) || load.driver || '', at: load.closed_at, warnings: warns.map((w) => w.msg) };
    load.close_gps = await getLocation(4000);
    load.sealed = (await sealRecord({ ...load, sealed: undefined })).seal;
    fresh.loads = fresh.loads.map((l) => (l.ref === ref ? load : l));
    await jobPut(fresh);
    toast('Load closed. Show the gate slip at the tip.', 'ok');
    go(`#/crew/job/${job.id}/gate/${encodeURIComponent(ref)}`);
  };
}

function renderChecks(checks) {
  if (!checks.length) return '<p class="ok-text">All checks passed.</p>';
  return checks.map((c) => `<div class="check-item ${c.level}">${c.level === 'block' ? '✕' : '!'} ${esc(c.msg)}</div>`).join('');
}

// ---------------- Crew: gate slip ----------------
async function viewGate(job, ref) {
  ref = decodeURIComponent(ref);
  const load = (job.loads || []).find((l) => l.ref === ref);
  if (!load) return go(`#/crew/job/${job.id}`);
  const byId = itemById(state.settings);
  const lines = loadLines(load, byId, premisesOf(job));
  const streams = streamTotals(lines);
  const c = state.settings.company;
  const site = (state.settings.sites || []).find((s) => s.id === load.destination_id);
  const pops = streams.filter((s) => s.pops);
  const contFor = (st) => {
    const secs = [...new Set(lines.filter((l) => (l.stream_key || `${l.code}|${l.description}`) === st.key).map((l) => l.section))];
    return [...new Set(secs.map((s) => load.containers?.[s]?.code || 'LOO'))].join('/');
  };
  view().innerHTML = `
  <div class="gate">
    <div class="gate-h">GATE SLIP · LOAD ${esc(ref)}</div>
    <div class="kv big"><span>Carrier</span><span>${esc(c.legal_name)}</span></div>
    <div class="kv big"><span>Registration</span><span>${esc(c.registration?.number || '')} (${esc(c.registration?.authority || '')}, ${esc(c.registration?.tier || '')})</span></div>
    <div class="kv big"><span>Vehicle</span><span>${esc(load.vehicle_reg || '')}</span></div>
    <div class="kv"><span>Our reference</span><span>${esc(ref)}</span></div>
    <div class="kv"><span>Collected from</span><span>${esc(job.collection?.postcode || '')}</span></div>
    <div class="kv"><span>Going to</span><span>${esc(site?.name || '')}</span></div>
    <table class="streams"><thead><tr><th>Code</th><th>Waste</th><th class="r">Items</th><th class="r">Est. kg</th><th>Cont.</th></tr></thead><tbody>
      ${streams.map((s) => `<tr class="${s.pops ? 'pops' : ''}"><td>${esc(s.code)}</td><td>${esc(s.description)}</td><td class="r">${esc(quantityText(s))}</td><td class="r">${s.kg_est == null ? 'n/k' : num(s.kg_est)}</td><td>${esc(contFor(s))}</td></tr>`).join('')}
    </tbody></table>
    <p class="small">Weights are <strong>estimated</strong> from item counts. Hazardous consignment code: <strong>none (non-hazardous waste transfer)</strong>.</p>
    ${pops.length ? `<p class="small pops-box"><strong>Contains POPs:</strong> domestic seating waste containing POPs (20 03 07). Chemicals: ${esc(pops[0].pops_chemicals || 'DecaBDE, HBCDD, PentaBDE, TetraBDE')}. Source: guidance; concentration not measured. Kept unmixed; unload separately.</p>` : ''}
  </div>
  <div class="card">
    <h2>At the tip (for our records, not the client)</h2>
    <label>Site ticket number<input id="tno" value="${esc(load.tip?.ticket_no || '')}" autocomplete="off"></label>
    <label>Weight on the ticket (kg)<input id="twt" inputmode="numeric" value="${esc(load.tip?.weight_kg ?? '')}"></label>
    ${job.photos_allowed === false ? '' : `<label>Photo of the ticket<input type="file" accept="image/*" capture="environment" id="tphoto"></label>${load.tip?.photo ? '<p class="muted small">Ticket photo ✓</p>' : ''}`}
    <button class="btn primary big" id="tsave">Save tip details</button>
    <button class="btn" id="tshare">Send tip details to office</button>
    <a class="btn" href="#/crew/job/${job.id}">Back to job</a>
  </div>`;
  let photo = load.tip?.photo || null;
  const tp = $('#tphoto');
  if (tp) tp.onchange = async (e) => { if (e.target.files[0]) { photo = await readPhoto(e.target.files[0]); toast('Ticket photo saved.', 'ok'); } };
  const saveTip = async () => {
    const tip = await sealRecord({ kind: 'tip_record', job_id: job.id, job_ref: job.ref, load_ref: ref, site_id: load.destination_id, site_name: site?.name || '',
      ticket_no: $('#tno').value.trim(), weight_kg: $('#twt').value ? Number($('#twt').value) : null, photo, recorded_at: nowIso(),
      estimate_kg: lineTotals(lines, byId).kg, vehicle_reg: load.vehicle_reg });
    const fresh = await jobGet(job.id);
    fresh.loads = fresh.loads.map((l) => (l.ref === ref ? { ...l, tip } : l));
    await jobPut(fresh);
    return tip;
  };
  $('#tsave').onclick = async () => { await saveTip(); toast('Tip details saved.', 'ok'); go(`#/crew/job/${job.id}`); };
  $('#tshare').onclick = async () => {
    const tip = await saveTip();
    const file = new File([JSON.stringify(tip, null, 1)], `tip-${ref}.json`, { type: 'application/json' });
    await shareFiles([file], `Tip record ${ref}`, `Tip record for load ${ref}, job ${job.ref}.`, state.settings.company.waste_email);
  };
}

// ---------------- Crew: found hazardous ----------------
async function viewHazard(job, itemId) {
  const types = ['Screens and monitors', 'Old CRT TVs or monitors', 'Laptops or tablets', 'Fridges, freezers or water coolers', 'Fluorescent tubes or lamps', 'UPS units or lead-acid batteries', 'Lithium batteries (loose)', 'Chemicals or cleaning products', 'Suspected asbestos', 'Not sure what it is'];
  const it = itemId ? itemById(state.settings).get(itemId) : null;
  const guess = it ? (types.find((t) => t.toLowerCase().includes(it.label.toLowerCase().split(/[ /,]/)[0])) || '') : '';
  view().innerHTML = `
  <div class="card danger-card">
    <h1>Found hazardous / not sure</h1>
    <ol class="rule"><li><strong>Do not load it.</strong></li><li>Leave it where it is, or move it only to a safe spot.</li><li>Keep people away if it is leaking or broken.</li><li>Photograph it and tag it "Not collected: hazardous".</li><li>Tell the ops manager before you leave site.</li></ol>
    <p class="small">These items need different paperwork, and the client has to be there to sign for them. Carrying them without it is an offence.${it?.crew_instruction ? ` ${esc(it.crew_instruction)}` : ''}</p>
  </div>
  <div class="card">
    <label>What is it?<select id="htype">${types.map((t) => `<option ${t === guess ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label>How many?<input id="hcount" inputmode="numeric" value="1"></label>
    <label>Where is it left?<input id="hwhere" placeholder="e.g. Floor 2 comms room"></label>
    ${job.photos_allowed === false ? '' : '<label>Photo<input type="file" accept="image/*" capture="environment" id="hphoto"></label>'}
    <label class="check"><input type="checkbox" id="htag"> Tagged "Not collected: hazardous"</label>
    <button class="btn primary big" id="hsave">Save and tell the office</button>
    <a class="btn" href="#/crew/job/${job.id}">Cancel</a>
  </div>`;
  let photo = null;
  const hp = $('#hphoto');
  if (hp) hp.onchange = async (e) => { if (e.target.files[0]) photo = await readPhoto(e.target.files[0], 1024); };
  $('#hsave').onclick = async () => {
    const entry = { at: nowIso(), type: $('#htype').value, count: Math.max(1, Number($('#hcount').value) || 1), where: $('#hwhere').value.trim(), tagged: $('#htag').checked, photo, gps: await getLocation(3000) };
    const fresh = await jobGet(job.id);
    fresh.hazards = [...(fresh.hazards || []), entry];
    fresh.crew = { ...(fresh.crew || {}), started: true };
    await jobPut(fresh);
    toast('Logged. It will be listed on the note as left on site.', 'ok');
    const text = `Hazardous item left on site: ${entry.count} x ${entry.type} at ${entry.where || 'site'} (job ${job.ref}, ${job.collection?.postcode || ''}). ${entry.tagged ? 'Tagged.' : 'NOT tagged.'} Please book a specialist collection.`;
    if (navigator.share) { try { await navigator.share({ title: `Hazardous item: job ${job.ref}`, text }); } catch { /* cancelled */ } }
    go(`#/crew/job/${job.id}`);
  };
}

// ---------------- Crew: finish ----------------
async function viewFinish(job) {
  const already = new Set((job.notes || []).flatMap((n) => n.load_refs || []));
  const closed = (job.loads || []).filter((l) => l.closed_at && !already.has(l.ref));
  const open = (job.loads || []).find((l) => !l.closed_at);
  const byId = itemById(state.settings);
  const lines = closed.flatMap((l) => loadLines(l, byId, premisesOf(job)));
  const streams = streamTotals(lines);
  const problems = [];
  if (!job.signoff && TRANSFEROR_TYPES[job.transferor_type]?.needsNote !== false) problems.push('The client has not signed the description.');
  if (open) problems.push(`Load ${open.ref} is still open.`);
  if (!closed.length) problems.push('No closed loads to put on a note.');
  view().innerHTML = `
  <div class="card">
    <h1>Finish: make the note</h1>
    <p>${closed.length} load(s): ${esc(closed.map((l) => l.ref).join(', '))}</p>
    <table class="streams"><thead><tr><th>Code</th><th>Waste</th><th class="r">Items</th><th class="r">Est. kg</th></tr></thead><tbody>
      ${streams.map((s) => `<tr class="${s.pops ? 'pops' : ''}"><td>${esc(s.code)}</td><td>${esc(s.description)}</td><td class="r">${esc(quantityText(s))}</td><td class="r">${s.kg_est == null ? 'n/k' : num(s.kg_est)}</td></tr>`).join('')}
    </tbody></table>
    ${(job.hazards || []).length ? `<p class="muted">Left on site: ${esc(job.hazards.map((h) => `${h.count} × ${h.type}`).join(', '))}</p>` : ''}
    ${problems.length ? `<div class="check-item block">✕ ${problems.map(esc).join('<br>✕ ')}</div>` : ''}
    <button class="btn primary big" id="make" ${problems.length ? 'disabled' : ''}>Make and seal the note</button>
    <a class="btn" href="#/crew/job/${job.id}">Back</a>
    <p class="muted small">The note is made on this phone and sealed. It can be sent now or later, with or without signal.</p>
  </div>`;
  $('#make').onclick = async () => {
    $('#make').disabled = true;
    $('#make').textContent = 'Making the note…';
    const fresh = await jobGet(job.id);
    const note = await buildJobNote(fresh, state.settings);
    const pdf = renderNotePdf(note, state.settings);
    fresh.notes = [...(fresh.notes || []), { number: note.number, issued_at: note.issued_at, fingerprint: note.seal.fingerprint, load_refs: note.load_refs, record: note, pdf: new Blob([pdf], { type: 'application/pdf' }) }];
    await jobPut(fresh);
    go(`#/crew/job/${job.id}/note/${encodeURIComponent(note.number)}?just=1`);
  };
}

// ---------------- Sharing ----------------
// Returns 'shared' (handed to the phone's share sheet), 'cancelled', or 'downloaded' (saved instead).
async function shareFiles(files, title, text, to) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title, text: `${text}${to ? `\n\nSend to: ${to}` : ''}` }); return 'shared'; } catch (err) { if (err.name === 'AbortError') return 'cancelled'; }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  if (to) toast(`Saved. Send it to: ${to}`);
  return 'downloaded';
}

async function noteFiles(job, number) {
  const fresh = await jobGet(job.id);
  const n = (fresh.notes || []).find((x) => x.number === number);
  if (!n) throw new Error('Note not found');
  const pdf = n.pdf instanceof Blob ? n.pdf : new Blob([renderNotePdf(n.record, state.settings)], { type: 'application/pdf' });
  return { n, pdf: new File([pdf], `${number}.pdf`, { type: 'application/pdf' }), json: new File([JSON.stringify(n.record)], `${number}.json`, { type: 'application/json' }) };
}

async function shareNote(job, number, who) {
  const { pdf, json } = await noteFiles(job, number);
  let result;
  if (who === 'client') {
    const to = [...new Set([...(job.notes_to || []), job.signatory?.email].filter(Boolean))].join(', ');
    result = await shareFiles([pdf], `Waste transfer note ${number}`, `Waste transfer note ${number} for job ${job.ref}.`, to);
  } else {
    result = await shareFiles([pdf, json], `Waste transfer note ${number} (office copy)`, `Office copy of ${number}: PDF and sealed record.`, state.settings.company.waste_email);
  }
  if (result === 'cancelled') return result;
  const fresh = await jobGet(job.id);
  fresh.notes = (fresh.notes || []).map((n) => (n.number === number ? { ...n, sent: { ...(n.sent || {}), [who]: { at: nowIso(), via: result } } } : n));
  await jobPut(fresh);
  return result;
}

const sentText = (x) => (x ? `${x.via === 'downloaded' ? 'saved to phone' : 'sent'} ${fmtTime(x.at)}` : null);
const unsentOffice = (jobs) => jobs.flatMap((j) => (j.notes || []).filter((n) => !n.sent?.office).map((n) => ({ job: j, note: n })));

// ---------------- Note screen (crew and office) ----------------
// Phones cannot show a PDF inside the app, so the note is shown as a page;
// the PDF is saved or shared from here.
const fmtFull = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function noteHtml(n) {
  const household = n.kind === 'household_receipt';
  const reg = n.transferee?.registration || {};
  const regLine = [reg.authority, reg.tier, reg.number].filter(Boolean).join(' · ');
  const kv = (rows) => rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  const addr = (a) => [a?.address, a?.postcode].filter(Boolean).join(', ');
  const kg = (v, unknown) => (v == null ? 'n/k' : `${num(v)}${unknown ? '+' : ''}`);
  const sigBox = (label, s, name, role, at, gps) => `<div class="sigbox"><div class="siglabel">${esc(label)}</div>
    ${s?.data ? `<img src="${esc(s.data)}" alt="Signature of ${esc(name || '')}">` : '<div class="muted">No signature</div>'}
    <div><strong>${esc([name, role].filter(Boolean).join(', '))}</strong></div>
    <div class="muted small">${fmtFull(at)}${gps ? ` · ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : ''}</div></div>`;
  const signatures = (s) => `<div class="sigs">${sigBox('Transferor (client)', s.client_signature, s.client_name, s.client_role, s.signed_at, s.gps)}${sigBox('Transferee (our crew lead)', s.crew_signature, s.crew_name, 'for the carrier', s.signed_at, null)}</div>
    ${s.seal?.fingerprint ? `<p class="muted small">Signed description sealed on the phone at signing: ${esc(shortPrint(s.seal.fingerprint))}</p>` : ''}`;
  const t = n.transferor || {};
  const containers = [...new Set((n.transfer?.loads || []).flatMap((l) => Object.values(l.containers || {}).map((c) => c.label || c)))];
  let h = `<header class="doc-h"><div><div class="doc-brand">${esc((n.transferee?.display_name || n.transferee?.trading_name || n.transferee?.legal_name || '').toUpperCase())}</div>
    <div class="doc-title">${household ? 'Household waste collection receipt' : 'Waste transfer note'}</div></div>
    <div class="doc-no"><strong>No. ${esc(n.number)}</strong><div>${esc(NATION_LABEL[n.nation] || '')}</div></div></header>`;
  if (household) {
    h += `<p>You do not need a waste transfer note for your own household waste. You do need to check it goes to a registered waste carrier. This receipt shows who took it, what was taken and where it is going.</p>
    <h3 class="doc-sec">Collected by</h3>${kv([['Company', n.transferee.legal_name], ['Address', addr(n.transferee)], ['Registered carrier', regLine]])}
    <h3 class="doc-sec">Collected from</h3>${kv([['Address', addr(n.transfer.place)], ['Collected', fmtFull(n.transfer.first_at)]])}`;
  } else {
    h += `<h3 class="doc-sec">1 The waste</h3>
    <table class="streams"><thead><tr><th>Code</th><th>Description</th><th class="r">Quantity</th><th class="r">Est. kg</th><th class="r">cu ft</th></tr></thead><tbody>
      ${(n.waste || []).map((s) => `<tr class="${s.pops ? 'pops' : ''}"><td>${esc(s.code)}</td><td>${esc(s.description)}${s.pops && s.pops_chemicals ? `<div class="small">POPs: ${esc(s.pops_chemicals)}</div>` : ''}</td><td class="r">${esc(quantityText(s))}</td><td class="r">${kg(s.kg_est, s.kgUnknown)}</td><td class="r">${esc(s.cu_ft)}</td></tr>`).join('')}
    </tbody></table>
    ${kv([['How it is contained', containers.length ? containers.join(', ') : 'Loose'], ['Quantity basis', n.quantities_basis]])}
    ${(n.waste || []).some((s) => s.pops) ? '<p class="pops-box small"><strong>Upholstered seating containing POPs</strong> is kept unmixed with other waste during carriage, unloaded separately, and goes only to an incinerator authorised to take POPs waste.</p>' : ''}
    <h3 class="doc-sec">2 Handed over by (transferor)</h3>
    ${kv([['Name', t.name], ['Address', [t.address, t.postcode].filter(Boolean).join(', ')],
      ['SIC code (2007)', t.sic || (n.job?.premises === 'domestic' ? 'Not applicable (domestic property)' : 'Not given')],
      ['They are', t.is_producer ? 'The producer of the waste' : 'The current holder of the waste (not the producer)'],
      ...(t.fm_name ? [['Work placed by', t.fm_name]] : []), ...(t.company_number ? [['Company number', t.company_number]] : [])])}
    <h3 class="doc-sec">3 Collected by (transferee)</h3>
    ${kv([['Name', [n.transferee.legal_name, n.transferee.trading_name && `trading as ${n.transferee.trading_name}`].filter(Boolean).join(', ')], ['Address', addr(n.transferee)],
      ['They are', `A registered waste carrier${/broker/i.test((reg.roles || []).join(' ')) ? ', broker and dealer' : ''}`], ['Registration', regLine]])}
    <h3 class="doc-sec">4 The transfer</h3>
    ${kv([['Place of transfer', addr(n.transfer.place)], ['Date and time', `${fmtFull(n.transfer.first_at)}${n.transfer.loads.length > 1 ? ` (first of ${n.transfer.loads.length} loads, see schedule)` : ''}`], ['Broker or dealer', 'None: collected and carried by the transferee']])}
    ${n.transfer.loads.length > 1 ? `<p class="muted small">${n.regime === 'SC' ? 'This note covers several loads of the waste described above between the same parties. Each load is listed in the schedule with its own details and signatures.' : 'This note covers a series of loads of the waste described above between the same parties. The transfer is treated as taking place at the first load (Environmental Protection Act 1990, s34(4A)(b)). Each load is listed in the schedule.'}</p>` : ''}
    <h3 class="doc-sec">5 Declarations</h3>
    ${n.regime === 'EW' ? `<p>${n.declarations?.hierarchy ? '☑' : '☐'} The transferor confirms they have fulfilled their duty to apply the waste hierarchy as required by regulation 12 of the Waste (England and Wales) Regulations 2011.</p>` : ''}
    <p>${n.declarations?.description_accurate ? '☑' : '☐'} The transferor confirms this description of the waste is accurate, and that each load is recorded against this note.</p>`;
  }
  if (n.signoff) {
    h += `<h3 class="doc-sec">${household ? 'Signatures' : '6 Signatures'}</h3>${signatures(n.signoff)}`;
    for (const a of n.addenda || []) h += `<p class="small"><strong>Addition signed ${fmtFull(a.signed_at)} for:</strong> ${esc(a.streams.map((s) => `${s.code} ${s.description}`).join('; '))}</p>${signatures(a)}`;
  }
  h += `<h3 class="doc-sec">${household ? 'What was taken' : '7 Load schedule'}</h3>`;
  for (const l of n.transfer.loads || []) {
    h += `<div class="doc-load"><p><strong>Load ${esc(l.ref)} · Vehicle ${esc(l.vehicle_reg || '?')}${l.vehicle_label ? ` (${esc(l.vehicle_label)})` : ''} · Left site ${fmtFull(l.closed_at)}</strong><br>
      Going to: ${esc([l.destination?.name, l.destination?.postcode].filter(Boolean).join(', ') || 'not recorded')}${l.destination?.permit_number ? ` · permit ${esc(l.destination.permit_number)}` : ''}</p>
      <table class="streams"><thead><tr><th>Item</th><th>Code</th><th class="r">Quantity</th><th class="r">Est. kg</th><th class="r">cu ft</th></tr></thead><tbody>
      ${l.lines.map((x) => `<tr class="${x.pops ? 'pops' : ''}"><td>${esc(x.label)}</td><td>${esc(x.code)}</td><td class="r">${esc(lineQuantity(x))}</td><td class="r">${kg(x.kg_est)}</td><td class="r">${x.cu_ft == null ? '' : esc(x.cu_ft)}</td></tr>`).join('')}
      </tbody></table>
      ${Object.keys(l.containers || {}).length ? `<p class="muted small">Contained: ${esc([...new Set(Object.values(l.containers).map((c) => c.label || c))].join(', '))}</p>` : ''}
      ${l.client_signature?.data ? `<div class="sigs">${sigBox('Client signed for this load', l.client_signature, l.client_signature.name, '', l.client_signature.at, null)}</div>` : ''}</div>`;
  }
  const { reuse, hazards_left: hz } = n.annex || {};
  if (reuse?.length || hz?.length) {
    h += `<h3 class="doc-sec">${household ? 'Not taken as waste' : '8 Not on this note'}</h3>`;
    if (reuse?.length) h += `<p><strong>Leaving for reuse or donation (not waste):</strong> ${esc(reuse.map((r) => `${r.count} × ${r.label} (load ${r.load})`).join('; '))}</p>`;
    if (hz?.length) h += `<p><strong>Hazardous items left on site for specialist collection (not carried):</strong> ${esc(hz.map((x) => `${x.count || 1} × ${x.type}${x.where ? ` at ${x.where}` : ''}${x.tagged ? ' (tagged)' : ''}`).join('; '))}</p>`;
  }
  h += `<footer class="doc-f"><p>${household ? 'Receipt for household waste collected by a registered carrier.' : n.regime === 'SC'
    ? 'Electronic transfer note: Environmental Protection (Duty of Care) (Scotland) Regulations 2014. Keep for at least 2 years.'
    : 'Electronic transfer note under regulation 35(4) and (5) of the Waste (England and Wales) Regulations 2011. Keep for at least 2 years.'}</p>
    <p>Sealed record fingerprint (SHA-256): <span class="fp">${esc(n.seal?.fingerprint || '')}</span></p>
    <p id="sealCheck" class="muted">Checking the seal…</p></footer>`;
  return `<article class="note-doc">${h}</article>`;
}

async function showNote(note, actions, back, banner = '') {
  view().innerHTML = `
  <div class="card no-print">
    <div class="row"><a class="btn small" href="${back}">← Back</a><span class="pill">${esc(note.number)}</span></div>
    ${banner}
    <div class="btnrow">${actions.map((a) => `<button class="btn ${a.primary ? 'primary' : ''}" data-act="${a.id}">${esc(a.label)}</button>`).join('')}</div>
  </div>
  ${noteHtml(note)}`;
  actions.forEach((a) => ($(`[data-act="${a.id}"]`).onclick = a.run));
  const v = await verifySeal(note);
  const el = $('#sealCheck');
  if (el) { el.className = v.ok ? 'ok-text' : 'check-item block'; el.textContent = v.ok ? 'Seal checks out: nothing in this note has changed since it was made.' : 'Seal broken: this record has been changed since it was made.'; }
}

async function viewNote(job, number, justMade = false) {
  const n = (job.notes || []).find((x) => x.number === number);
  if (!n) { toast('That note is not on this phone.', 'bad'); return go(`#/crew/job/${job.id}`); }
  const save = async () => { const { pdf } = await noteFiles(job, number); downloadBlob(pdf.name, pdf); toast('PDF saved to Downloads.', 'ok'); };
  const send = async (who) => {
    const r = await shareNote(job, number, who);
    if (r !== 'cancelled') viewNote(await jobGet(job.id), number);
  };
  const office = sentText(n.sent?.office);
  const client = sentText(n.sent?.client);
  const banner = office
    ? `<p class="ok-text">Office copy ${esc(office)}.${client ? ` Client copy ${esc(client)}.` : ' Client copy not sent yet.'}</p>`
    : `<div class="check-item block">${justMade ? 'Note made and sealed. Now send the office copy: until you do, it only exists on this phone.' : 'Office copy not sent yet: this note only exists on this phone.'}</div>`;
  await showNote(n.record, [
    ...(office ? [] : [{ id: 'office', label: 'Send office copy now', primary: true, run: () => send('office') }]),
    { id: 'client', label: 'Send to client', primary: !!office, run: () => send('client') },
    ...(office ? [{ id: 'office', label: 'Send office copy again', run: () => send('office') }] : []),
    { id: 'save', label: 'Save PDF', run: save },
    { id: 'print', label: 'Print', run: () => window.print() },
  ], `#/crew/job/${job.id}`, banner);
}

async function viewRegisterNote(key) {
  const e = (await regAll()).find((x) => x.key === key);
  if (!e || e.kind !== 'note') { toast('That note is not in the register on this device.', 'bad'); return go('#/office/register'); }
  const pdf = () => new File([renderNotePdf(e.record, state.settings)], `${e.record.number}.pdf`, { type: 'application/pdf' });
  await showNote(e.record, [
    { id: 'save', label: 'Save PDF', primary: true, run: () => { const f = pdf(); downloadBlob(f.name, f); } },
    { id: 'share', label: 'Share PDF', run: () => shareFiles([pdf()], `Waste transfer note ${e.record.number}`, `Waste transfer note ${e.record.number}.`) },
    { id: 'print', label: 'Print', run: () => window.print() },
  ], `#/office/register?note=${encodeURIComponent(key)}`);
}

// ---------------- Office: job form ----------------
async function viewJobForm(existing) {
  const s = state.settings;
  const job = existing ? structuredClone(existing) : {
    id: uid(), origin: 'office', ref: '', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), job_type: 'office',
    transferor_type: 'business_occupier', collection: {}, producer: {}, signatory: {}, fm: {}, planned_sites: [], expected_streams: [],
    survey_counts: {}, photos_allowed: true, depot: s.depots?.[0]?.id || '',
  };
  view().innerHTML = `${nav(existing ? 'jobs' : 'new')}
  <form id="jf" class="form">
    <div class="card"><h1>${existing ? `Edit job ${esc(job.ref)}` : 'New waste job'}</h1>
      <label>Job or quote reference<input name="ref" value="${esc(job.ref)}" required></label>
      <div class="grid2">
        <label>Depot<select name="depot">${(s.depots || []).map((d) => `<option value="${esc(d.id)}" ${d.id === job.depot ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        <label>Date<input type="date" name="date" value="${esc(job.date)}"></label>
      </div>
      <label>Type of job<select name="job_type">${[['office', 'Office / commercial clearance'], ['work_order', 'Repeat work order (FM contract)'], ['domestic', 'Domestic clearance']].map(([v, l]) => `<option value="${v}" ${v === job.job_type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="card"><h2>Who is handing over the waste?</h2>
      ${Object.entries(TRANSFEROR_TYPES).map(([k, t]) => `<label class="check"><input type="radio" name="transferor_type" value="${k}" ${k === job.transferor_type ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}
      <p class="muted small">Householders clearing their own home get a receipt, not a transfer note. Landlords, agents and executors need a full note.</p>
    </div>
    <div class="card"><h2>Collection address</h2>
      <label>Address<textarea name="c_address" rows="2">${esc(job.collection.address)}</textarea></label>
      <div class="grid2"><label>Postcode<input name="c_postcode" value="${esc(job.collection.postcode)}" autocapitalize="characters"></label>
      <label>Nation<select name="nation"><option value="">Choose</option>${Object.entries(NATION_LABEL).map(([k, l]) => `<option value="${k}" ${k === job.nation ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <p class="muted small" id="nationHint"></p>
    </div>
    <div class="card" id="producerCard"><h2>Waste producer (who the waste belongs to)</h2>
      <p class="muted small">Not always the billing account. When an FM contractor places the work, the producer is usually the occupier they work for.</p>
      <label>Name<input name="p_name" value="${esc(job.producer.name)}"></label>
      <label class="check"><input type="checkbox" name="p_same" ${!job.producer.address || job.producer.address === job.collection.address ? 'checked' : ''}> Same address as the collection</label>
      <label>Address<textarea name="p_address" rows="2">${esc(job.producer.address)}</textarea></label>
      <div class="grid2"><label>Postcode<input name="p_postcode" value="${esc(job.producer.postcode)}" autocapitalize="characters"></label>
      <label>SIC code (2007)<input name="p_sic" value="${esc(job.producer.sic)}" inputmode="numeric" placeholder="e.g. 84110"></label></div>
      <label>Company number (optional)<input name="p_company_number" value="${esc(job.producer.company_number)}"></label>
      <label id="fmRow">FM contractor who placed the work<input name="fm_name" value="${esc(job.fm?.name)}"></label>
    </div>
    <div class="card"><h2>Who signs for the client</h2>
      <div class="grid2"><label>Name<input name="s_name" value="${esc(job.signatory.name)}"></label><label>Role<input name="s_role" value="${esc(job.signatory.role)}"></label></div>
      <div class="grid2"><label>Email (note goes here)<input type="email" name="s_email" value="${esc(job.signatory.email)}"></label><label>Phone<input name="s_phone" value="${esc(job.signatory.phone)}"></label></div>
      <label>Also send notes to (comma separated)<input name="notes_to" value="${esc((job.notes_to || []).join(', '))}"></label>
      <label class="check"><input type="checkbox" name="photos_allowed" ${job.photos_allowed !== false ? 'checked' : ''}> Photos are allowed on this site</label>
    </div>
    <div class="card"><h2>Tip sites for this job</h2>
      ${(s.sites || []).map((site) => `<label class="check"><input type="checkbox" name="site" value="${esc(site.id)}" ${job.planned_sites.includes(site.id) ? 'checked' : ''}> ${esc(site.name)} <span class="muted small">${esc(site.postcode || '')} · ${site.permit_number ? `permit ${esc(site.permit_number)}` : '<strong>permit not recorded</strong>'} · takes ${esc((site.accepts || []).join(', '))}</span></label>`).join('')}
    </div>
    <div class="card"><h2>Waste expected</h2>
      <p class="muted small">Tick every kind of waste that may go. The client signs this list before the first load. Anything else needs a signed addition on the day.</p>
      <div id="streams"></div>
      <details><summary>Survey counts (optional)</summary><div id="survey" class="survey"></div></details>
    </div>
    <div class="card" id="checksCard"><h2>Checks</h2><div id="deskChecks"></div>
      <label class="check" id="ackRow" hidden><input type="checkbox" id="ack"> I have read the warnings</label>
      <button class="btn primary big" type="submit">Check and create the job pack</button>
      ${existing ? `<button class="btn danger" type="button" id="del">Delete job</button>` : ''}
    </div>
  </form>`;

  const f = $('#jf');
  const read = () => {
    const d = new FormData(f);
    job.ref = d.get('ref').trim();
    job.depot = d.get('depot');
    job.ref_prefix = (s.depots || []).find((x) => x.id === job.depot)?.ref_prefix || job.depot || 'WN';
    job.date = d.get('date');
    job.job_type = d.get('job_type');
    job.transferor_type = d.get('transferor_type');
    job.premises = TRANSFEROR_TYPES[job.transferor_type]?.premises || 'commercial';
    job.collection = { address: d.get('c_address').trim(), postcode: d.get('c_postcode').trim().toUpperCase() };
    job.nation = d.get('nation');
    const same = d.get('p_same') === 'on';
    job.producer = { name: d.get('p_name').trim(), address: same ? job.collection.address : d.get('p_address').trim(), postcode: same ? job.collection.postcode : d.get('p_postcode').trim().toUpperCase(), sic: d.get('p_sic').trim(), company_number: d.get('p_company_number').trim() };
    job.fm = { name: d.get('fm_name').trim() };
    job.signatory = { name: d.get('s_name').trim(), role: d.get('s_role').trim(), email: d.get('s_email').trim(), phone: d.get('s_phone').trim() };
    job.notes_to = d.get('notes_to').split(',').map((x) => x.trim()).filter(Boolean);
    job.photos_allowed = d.get('photos_allowed') === 'on';
    job.planned_sites = d.getAll('site');
    job.expected_streams = d.getAll('stream');
    job.survey_counts = Object.fromEntries($$('[data-survey]').map((i) => [i.dataset.survey, Number(i.value) || 0]).filter(([, v]) => v > 0));
    if (job.transferor_type === 'householder') job.producer = { name: job.signatory.name || 'Householder', address: job.collection.address, postcode: job.collection.postcode };
  };
  const renderStreams = () => {
    const premises = TRANSFEROR_TYPES[new FormData(f).get('transferor_type')]?.premises || 'commercial';
    const streams = streamsFromItems(s.items, premises);
    const surveyKeys = new Set(Object.entries(job.survey_counts || {}).filter(([, v]) => v > 0).map(([id]) => { const it = itemById(s).get(id); return it ? streamKey(it, premises) : null; }));
    $('#streams').innerHTML = streams.map((st) => `<label class="check ${st.pops ? 'pops' : ''}"><input type="checkbox" name="stream" value="${esc(st.key)}" ${job.expected_streams.includes(st.key) || surveyKeys.has(st.key) ? 'checked' : ''}> <strong>${esc(st.code)}</strong> ${esc(st.description)} <span class="muted small">e.g. ${esc(st.examples.join(', '))}</span></label>`).join('');
    $('#survey').innerHTML = s.items.filter((it) => availableFor(it, premises) && !hazardousFor(it, premises)).map((it) => `<label class="inline">${esc(it.label)}<input type="number" min="0" inputmode="numeric" data-survey="${esc(it.id)}" value="${job.survey_counts?.[it.id] || ''}"></label>`).join('');
  };
  const refresh = () => {
    read();
    const n = nationFromPostcode(job.collection.postcode);
    $('#nationHint').textContent = n.nation ? `Postcode suggests ${NATION_LABEL[n.nation]}${n.certain ? '' : ' (border area: please check)'}.` : '';
    if (n.nation && n.certain && !f.nation.value) { f.nation.value = n.nation; job.nation = n.nation; }
    $('#producerCard').hidden = job.transferor_type === 'householder';
    $('#fmRow').hidden = job.transferor_type !== 'fm_for_occupier';
    f.p_address.closest('label').hidden = f.p_same.checked;
    f.p_postcode.closest('label').hidden = f.p_same.checked;
    const checks = deskChecks(job, s);
    $('#deskChecks').innerHTML = renderChecks(checks);
    $('#ackRow').hidden = !checks.some((c) => c.level === 'warn');
  };
  renderStreams();
  refresh();
  f.addEventListener('input', debounce(refresh, 300));
  f.addEventListener('change', (e) => { if (e.target.name === 'transferor_type') { read(); renderStreams(); } if (e.target.dataset.survey) { read(); renderStreams(); } refresh(); });
  const del = $('#del');
  if (del) del.onclick = async () => { if (confirm('Delete this job from this device?')) { await jobDel(job.id); go('#/office'); } };
  f.onsubmit = async (e) => {
    e.preventDefault();
    read();
    const checks = deskChecks(job, s);
    if (blocking(checks).length) { refresh(); $('#checksCard').scrollIntoView({ behavior: 'smooth' }); return toast('Fix the red items first.', 'bad'); }
    if (checks.some((c) => c.level === 'warn') && !$('#ack').checked) return toast('Tick that you have read the warnings.', 'bad');
    if (!job.load_refs?.length) {
      const key = `counter:${job.ref_prefix}`;
      const next = ((await kvGet(key)) || 0) + 1;
      job.load_refs = Array.from({ length: 6 }, (_, i) => `${job.ref_prefix}-${String(next + i).padStart(6, '0')}`);
      await kvSet(key, next + 5);
    }
    job.checks = { at: nowIso(), warnings: checks.filter((c) => c.level === 'warn').map((c) => c.msg) };
    job.issued_at = nowIso();
    job.origin = 'office';
    await jobPut(job);
    go(`#/office/sent/${job.id}`);
  };
}

function packJob(job) {
  const { crew, loads, signoff, addenda, hazards, notes, updated_at, ...base } = job;
  const sites = (state.settings.sites || []).filter((x) => job.planned_sites.includes(x.id));
  return { kind: 'job', job: { ...base, sites_snapshot: sites, items_version: state.settings.items_version } };
}

async function viewJobSent(job) {
  if (!job) return go('#/office');
  const link = `${location.origin}${location.pathname}#pack=${await encodePack(packJob(job))}`;
  view().innerHTML = `${nav('jobs')}
  <div class="card">
    <h1>Job pack ready: ${esc(job.ref)}</h1>
    <p>Send this link to the crew lead. Opening it once puts the job on their phone; after that it works with no signal.</p>
    <textarea readonly rows="4" id="link">${esc(link)}</textarea>
    <div class="btnrow"><button class="btn primary" id="share">Send link</button><button class="btn" id="copy">Copy link</button><a class="btn" href="#/office/edit/${job.id}">Edit job</a></div>
    <p class="muted small">Load references reserved: ${esc((job.load_refs || []).join(', '))}</p>
    ${job.checks?.warnings?.length ? `<div class="check-item warn">! ${job.checks.warnings.map(esc).join('<br>! ')}</div>` : ''}
    <details><summary>Testing on this device</summary><button class="btn" id="asCrew">Open it here as the crew lead</button></details>
  </div>`;
  $('#copy').onclick = async () => { await navigator.clipboard.writeText(link); toast('Link copied.', 'ok'); };
  $('#share').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Job ${job.ref}`, text: `Waste job ${job.ref} (${fmtDate(job.date)}). Open on your phone:`, url: link }); } catch { /* cancelled */ } }
    else { await navigator.clipboard.writeText(link); toast('Link copied. Paste it into a message.', 'ok'); }
  };
  $('#asCrew').onclick = async () => {
    const fresh = await jobGet(job.id);
    fresh.crew = fresh.crew || { received_at: nowIso() };
    fresh.loads = fresh.loads || []; fresh.hazards = fresh.hazards || []; fresh.addenda = fresh.addenda || []; fresh.notes = fresh.notes || [];
    await jobPut(fresh);
    state.mode = 'crew'; await kvSet('mode', 'crew');
    go(`#/crew/job/${job.id}`);
  };
}

async function viewOfficeJobs() {
  const jobs = (await jobAll()).filter((j) => j.origin === 'office').sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const reg = await regAll();
  const noted = new Set(reg.filter((r) => r.kind === 'note').map((r) => r.record.job?.id));
  view().innerHTML = `${nav('jobs')}
  <div class="row"><h1>Waste jobs</h1><a class="btn primary" href="#/office/new">New job</a></div>
  ${jobs.length ? `<table class="list"><thead><tr><th>Ref</th><th>Date</th><th>Producer</th><th>Postcode</th><th>Note back?</th><th></th></tr></thead><tbody>
    ${jobs.map((j) => `<tr><td><strong>${esc(j.ref)}</strong></td><td>${fmtDate(j.date)}</td><td>${esc(j.producer?.name || '')}</td><td>${esc(j.collection?.postcode || '')}</td>
      <td>${noted.has(j.id) ? '<span class="pill ok">Received</span>' : (j.date && j.date < new Date().toISOString().slice(0, 10) ? '<span class="pill bad">Missing</span>' : '<span class="pill">Not yet</span>')}</td>
      <td><a href="#/office/sent/${j.id}">Link</a> · <a href="#/office/edit/${j.id}">Edit</a></td></tr>`).join('')}
  </tbody></table>` : '<div class="card"><p>No jobs yet.</p></div>'}
  ${await backupCard(jobs.length)}`;
  bindBackup();
}

// ---------------- Office: register ----------------
async function viewRegister(openKey) {
  const entries = (await regAll()).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const notes = entries.filter((e) => e.kind === 'note');
  const tips = entries.filter((e) => e.kind === 'tip');
  const tipByLoad = new Map(tips.map((t) => [t.record.load_ref, t.record]));
  view().innerHTML = `${nav('register')}
  <div class="row"><h1>Waste register</h1></div>
  <div class="card">
    <p>Add the sealed records (.json) that crews send to the waste inbox. Each one is checked against its seal.</p>
    <input type="file" id="imp" accept="application/json,.json" multiple>
    <div class="btnrow"><button class="btn" id="csv">Download register (CSV)</button><button class="btn" id="zoho">Download for Zoho (2 files)</button><button class="btn" id="pack">Duty-of-care pack for a client…</button></div>
  </div>
  ${notes.length ? `<table class="list"><thead><tr><th>Note</th><th>Date</th><th>Producer</th><th class="r">Loads</th><th class="r">Items</th><th class="r">Est. kg</th><th class="r">Tip kg</th><th>Seal</th><th>Flags</th></tr></thead><tbody>
    ${notes.map((e) => {
      const r = e.record;
      const items = r.waste.reduce((a, w) => a + w.count, 0);
      const kg = r.waste.reduce((a, w) => a + (w.kg_est || 0), 0);
      const tipKg = r.transfer.loads.map((l) => tipByLoad.get(l.ref)?.weight_kg).filter((v) => v != null);
      const flags = honestyFlags(r, state.settings);
      return `<tr class="${e.key === openKey ? 'sel' : ''}"><td><a href="#/office/register?note=${encodeURIComponent(e.key)}">${esc(r.number)}</a></td><td>${fmtDate(r.transfer.first_at)}</td><td>${esc(r.transferor.name)}</td>
        <td class="r">${r.transfer.loads.length}</td><td class="r">${num(items)}</td><td class="r">${num(kg)}</td><td class="r">${tipKg.length ? num(tipKg.reduce((a, b) => a + b, 0)) : '–'}</td>
        <td>${e.seal_ok ? '<span class="pill ok">OK</span>' : '<span class="pill bad">BROKEN</span>'}</td><td>${flags.length ? `<span class="pill warn" title="${esc(flags.join(' | '))}">${flags.length}</span>` : ''}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="card"><p class="muted">No notes in the register yet.</p></div>'}
  <div id="detail"></div>`;

  $('#imp').onchange = async (e) => {
    let added = 0, bad = 0;
    for (const f of e.target.files) {
      try {
        const rec = JSON.parse(await f.text());
        const v = await verifySeal(rec);
        if (rec.schema === 'waste-notes/1') {
          await regPut({ key: `note:${rec.number}:${rec.seal?.fingerprint}`, kind: 'note', date: rec.transfer?.first_at, record: rec, seal_ok: v.ok, imported_at: nowIso() });
        } else if (rec.kind === 'tip_record') {
          await regPut({ key: `tip:${rec.load_ref}:${rec.seal?.fingerprint}`, kind: 'tip', date: rec.recorded_at, record: rec, seal_ok: v.ok, imported_at: nowIso() });
        } else throw new Error('Unknown record');
        if (!v.ok) bad++;
        added++;
      } catch { bad++; }
    }
    toast(`Added ${added} record(s)${bad ? `, ${bad} with problems` : ''}.`, bad ? 'bad' : 'ok');
    viewRegister();
  };
  $('#csv').onclick = () => downloadText(`waste-register-${new Date().toISOString().slice(0, 10)}.csv`, registerCsv(notes, tipByLoad), 'text/csv');
  $('#zoho').onclick = () => {
    if (!notes.length) return toast('No notes in the register yet.', 'bad');
    const files = zohoImportFiles(notes, tipByLoad);
    const day = new Date().toISOString().slice(0, 10);
    downloadText(`zoho-notes-${day}.csv`, files.notes, 'text/csv');
    setTimeout(() => downloadText(`zoho-lines-${day}.csv`, files.lines, 'text/csv'), 500);
    toast('Two files downloaded. In Zoho, import the notes file first, then the lines file.', 'ok');
  };
  $('#pack').onclick = () => {
    const who = prompt('Producer name (or part of it) for the pack:');
    if (!who) return;
    const sel = notes.filter((e) => e.record.transferor.name.toLowerCase().includes(who.toLowerCase()));
    if (!sel.length) return toast('No notes for that name.', 'bad');
    downloadText(`duty-of-care-${who.replace(/\W+/g, '-')}.csv`, registerCsv(sel, tipByLoad, false), 'text/csv');
    sel.forEach((e) => downloadBlob(`${e.record.number}.pdf`, new Blob([renderNotePdf(e.record, state.settings)], { type: 'application/pdf' })));
  };

  if (openKey) {
    const e = entries.find((x) => x.key === openKey);
    if (e) {
      const r = e.record;
      const flags = honestyFlags(r, state.settings);
      $('#detail').innerHTML = `<div class="card"><h2>${esc(r.number)}</h2>
        <p>${e.seal_ok ? '<span class="pill ok">Seal checks out: nothing changed since it was made</span>' : '<span class="pill bad">Seal broken: this record was changed after sealing</span>'}</p>
        <p class="muted small">Fingerprint ${esc(r.seal?.fingerprint || '')}</p>
        <p>${esc(r.transferor.name)} · ${esc(r.transfer.place.postcode)} · ${r.transfer.loads.length} load(s) · signed by ${esc(r.signoff?.client_name || '')} ${fmtTime(r.signoff?.signed_at)}</p>
        ${flags.length ? `<div class="check-item warn">! ${flags.map(esc).join('<br>! ')}</div>` : ''}
        ${r.review_needed ? '<div class="check-item warn">! Unlisted items need a waste code before this note is final.</div>' : ''}
        <table class="streams"><thead><tr><th>Load</th><th>Vehicle</th><th>Destination</th><th class="r">Est. kg</th><th class="r">Tip kg</th><th>Ticket</th></tr></thead><tbody>
        ${r.transfer.loads.map((l) => { const t = tipByLoad.get(l.ref); return `<tr><td>${esc(l.ref)}</td><td>${esc(l.vehicle_reg)}</td><td>${esc(l.destination?.name || '')}</td><td class="r">${num(l.totals?.kg)}</td><td class="r">${t?.weight_kg != null ? num(t.weight_kg) : '–'}</td><td>${esc(t?.ticket_no || '')}</td></tr>`; }).join('')}
        </tbody></table>
        <div class="btnrow"><a class="btn primary" href="#/office/note/${encodeURIComponent(e.key)}">View note</a><button class="btn" id="pdf">Make the PDF again</button><button class="btn danger" id="rm">Remove from register</button></div></div>`;
      $('#pdf').onclick = () => downloadBlob(`${r.number}.pdf`, new Blob([renderNotePdf(r, state.settings)], { type: 'application/pdf' }));
      $('#rm').onclick = async () => { if (confirm('Remove this record from the register on this device?')) { await regDel(e.key); go('#/office/register'); } };
      $('#detail').scrollIntoView({ behavior: 'smooth' });
    }
  }
}

function registerCsv(notes, tipByLoad, internal = true) {
  const head = ['note_number', 'seal_ok', 'job_ref', 'depot', 'first_load_at', 'producer', 'producer_sic', 'collection_postcode', 'nation', 'signed_by', 'load_ref', 'load_left_at', 'vehicle_reg', 'destination', 'destination_permit', 'item', 'waste_code', 'description', 'count', 'est_kg', 'cu_ft', 'pops'];
  if (internal) head.push('tip_ticket', 'tip_weight_kg');
  const rows = [head];
  for (const e of notes) {
    const r = e.record;
    for (const l of r.transfer.loads) {
      const t = tipByLoad.get(l.ref);
      l.lines.forEach((x, i) => {
        const row = [r.number, e.seal_ok ? 'yes' : 'NO', r.job.ref, r.job.depot, r.transfer.first_at, r.transferor.name, r.transferor.sic, r.transfer.place.postcode, r.nation, r.signoff?.client_name, l.ref, l.closed_at, l.vehicle_reg, l.destination?.name, l.destination?.permit_number, x.label, x.code, x.description, x.count, x.kg_est, x.cu_ft, x.pops ? 'yes' : ''];
        if (internal) row.push(i === 0 ? t?.ticket_no || '' : '', i === 0 ? t?.weight_kg ?? '' : '');
        rows.push(row);
      });
    }
  }
  return rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}

// ---------------- Office: settings ----------------
async function viewSettings() {
  const s = state.settings;
  view().innerHTML = `${nav('settings')}
  <div class="card"><h1>Settings</h1>
    <div class="kv"><span>Company</span><span>${esc(s.company.legal_name)}</span></div>
    <div class="kv"><span>Registration</span><span>${esc(s.company.registration?.authority || '')} ${esc(s.company.registration?.number || '')} (${esc(s.company.registration?.tier || '')}), expires ${esc(s.company.registration?.expiry || '?')}</span></div>
    <div class="kv"><span>Item list</span><span>${s.items.length} items · version ${esc(s.items_version || '')}</span></div>
    <div class="kv"><span>Tip sites</span><span>${(s.sites || []).length} (${(s.sites || []).filter((x) => !x.permit_number).length} without a permit number)</span></div>
    <div class="kv"><span>This device</span><span>${state.mode === 'office' ? 'Office' : "Crew lead's phone"} · <button class="link" id="switch">switch</button></span></div>
    <div class="kv"><span>Storage</span><span>${(await navigator.storage?.persisted?.()) ? 'Protected: the browser will not clear it to save space' : 'Not protected: install the app to the home screen to protect it'}</span></div>
  </div>
  <div class="card"><h2>Set up a crew phone</h2>
    <p>Send this link to each crew lead once, and again whenever the item list changes.</p>
    <button class="btn primary" id="mkLink">Make the setup link</button>
    <textarea id="setupOut" rows="3" readonly hidden></textarea>
  </div>
  <div class="card"><h2>Load new settings</h2>
    <input type="file" id="newSettings" accept="application/json,.json">
    <button class="btn" id="dl">Download current settings</button>
  </div>
  ${await backupCard((await jobAll()).length)}
  <div class="card"><h2>Tip sites</h2>
    <table class="list"><thead><tr><th>Site</th><th>Postcode</th><th>Permit</th><th>Takes</th></tr></thead><tbody>
    ${(s.sites || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.postcode || '')}</td><td>${x.permit_number ? esc(x.permit_number) : '<span class="pill bad">missing</span>'}</td><td class="small">${esc((x.accepts || []).join(', '))}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <p class="muted small">Waste Notes ${APP_VERSION}</p>`;
  bindBackup();
  $('#switch').onclick = async () => { state.mode = state.mode === 'office' ? 'crew' : 'office'; await kvSet('mode', state.mode); go(state.mode === 'office' ? '#/office' : '#/crew'); };
  $('#mkLink').onclick = async () => {
    const link = `${location.origin}${location.pathname}#setup=${await encodePack({ kind: 'setup', settings: s })}`;
    const out = $('#setupOut'); out.hidden = false; out.value = link;
    if (navigator.share) { try { await navigator.share({ title: 'Waste Notes setup', text: 'Open this on your phone to set up Waste Notes:', url: link }); } catch { /* cancelled */ } }
    else { await navigator.clipboard.writeText(link); toast('Setup link copied.', 'ok'); }
  };
  $('#newSettings').onchange = async (e) => { const f = e.target.files[0]; if (f) { try { await saveSettings(JSON.parse(await f.text())); } catch (err) { toast(err.message, 'bad'); } } };
  $('#dl').onclick = () => downloadText('waste-notes-settings.json', JSON.stringify(s, null, 1), 'application/json');
}

function viewHelp() {
  view().innerHTML = `
  <div class="card"><h1>What this app does</h1>
    <ol>
      <li>The office sets up a waste job and checks it: who the waste belongs to, their SIC code, who signs, which tip sites, what waste is expected. It sends the crew lead a job link.</li>
      <li>Before the first load leaves, the client's named person signs the description of the waste on the phone. It is sealed there and then.</li>
      <li>The crew lead counts items onto each van load from a fixed list. Upholstered seating, electricals and hazardous items each have their own section. Hazardous items are never loaded: they are logged and left.</li>
      <li>At the tip, the gate slip shows the details the site must record. The ticket number and weight are kept for our records.</li>
      <li>At the end, the phone makes the waste transfer note as a PDF and seals it. The client gets the PDF, and the office gets the PDF plus the sealed record for the register.</li>
    </ol>
    <p>Everything works with no signal. Nothing is sent anywhere unless someone presses Send.</p>
    <p class="muted small">Quantities on notes are item counts; weights are estimates from the item list. Sealing uses SHA-256: if anything in a record changes after it is made, the register shows the seal as broken.</p>
    <a class="btn" href="#/">Back</a>
  </div>`;
}

// ---------------- Backup and restore ----------------
// One file with every job, note record and register entry on this device.
// PDFs are left out: they are remade exactly from the sealed records.
async function backupCard(jobCount) {
  const last = await kvGet('last_backup');
  const ageDays = last ? (Date.now() - Date.parse(last.at)) / 86400000 : Infinity;
  const stale = jobCount > 0 && ageDays > 3;
  const where = state.mode === 'office' ? 'computer' : 'phone';
  return `<div class="card ${stale ? 'warn-card' : ''}"><h2>Back up this ${where}</h2>
    <p class="muted small">${last ? `Last backup ${fmtTime(last.at)} (${last.jobs} job${last.jobs === 1 ? '' : 's'}, ${last.via === 'downloaded' ? 'saved to this device' : 'sent'}).` : 'Never backed up.'}
    ${stale ? ` Jobs and notes live only on this ${where} until they are sent or backed up.` : ''}</p>
    <button class="btn ${stale ? 'primary' : ''}" data-backup>Back up now</button>
    <details><summary>Restore from a backup</summary><input type="file" accept="application/json,.json" data-restore>
      <p class="muted small">Adds anything missing and keeps whichever copy of a job is newer. Nothing is deleted.</p></details></div>`;
}

function bindBackup() {
  $$('[data-backup]').forEach((b) => (b.onclick = makeBackup));
  $$('[data-restore]').forEach((i) => (i.onchange = async (e) => { const f = e.target.files[0]; if (f) await restoreBackup(f); }));
}

async function makeBackup() {
  const jobs = (await jobAll()).map(({ notes, ...j }) => ({ ...j, notes: (notes || []).map(({ pdf, ...n }) => n) }));
  const register = await regAll();
  const backup = await sealRecord({
    kind: 'waste-notes-backup', schema: 1, made_at: nowIso(), app_version: APP_VERSION, device: state.mode || 'crew',
    company: state.settings?.company?.legal_name || null, items_version: state.settings?.items_version || null, jobs, register,
  });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = new File([JSON.stringify(backup)], `waste-notes-backup-${stamp}.json`, { type: 'application/json' });
  const res = await shareFiles([file], 'Waste Notes backup', `Backup of ${jobs.length} job(s) and ${register.length} register record(s), made ${fmtTime(backup.made_at)}.`, state.settings?.company?.waste_email);
  if (res === 'cancelled') return;
  await kvSet('last_backup', { at: backup.made_at, via: res, jobs: jobs.length });
  toast(res === 'downloaded' ? 'Backup saved to this device.' : 'Backup sent.', 'ok');
  route();
}

async function restoreBackup(file) {
  let b;
  try { b = JSON.parse(await file.text()); } catch { return toast('That file is not a backup.', 'bad'); }
  if (b?.kind !== 'waste-notes-backup') return toast('That file is not a Waste Notes backup.', 'bad');
  const v = await verifySeal(b);
  if (!v.ok && !confirm('This backup has been changed since it was made. Restore it anyway?')) return;
  let added = 0, updated = 0, kept = 0;
  for (const j of b.jobs || []) {
    const cur = await jobGet(j.id);
    if (!cur) { await jobPut(j); added++; }
    else if (String(j.updated_at || '') > String(cur.updated_at || '')) {
      // Keep any note PDFs this device already holds.
      const pdfs = new Map((cur.notes || []).filter((n) => n.pdf).map((n) => [n.number, n.pdf]));
      await jobPut({ ...j, notes: (j.notes || []).map((n) => (pdfs.has(n.number) ? { ...n, pdf: pdfs.get(n.number) } : n)) });
      updated++;
    } else kept++;
  }
  for (const r of b.register || []) await regPut(r);
  toast(`Restored: ${added} new, ${updated} updated, ${kept} already up to date${(b.register || []).length ? `, ${b.register.length} register records` : ''}.`, 'ok');
  route();
}

// ---------------- Utilities ----------------
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function downloadBlob(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function downloadText(name, text, type) { downloadBlob(name, new Blob([text], { type })); }

boot();
