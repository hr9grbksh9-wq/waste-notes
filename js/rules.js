// Waste rules: nations, who is handing over, desk checks before dispatch,
// load checks, streams and totals. Pure functions — no DOM, no storage.

export const TRANSFEROR_TYPES = {
  business_occupier: { label: 'Business occupier (the client produces the waste)', premises: 'commercial', isProducer: true, needsNote: true },
  fm_for_occupier: { label: 'FM contractor acting for the occupier (the occupier produces the waste)', premises: 'commercial', isProducer: true, needsNote: true },
  landlord_agent_executor: { label: 'Landlord, letting agent or executor (domestic property)', premises: 'domestic', isProducer: false, needsNote: true },
  householder: { label: 'Householder clearing their own home', premises: 'domestic', isProducer: true, needsNote: false },
  own_waste: { label: "Our own waste (depot, packaging)", premises: 'commercial', isProducer: true, needsNote: true },
};

export const CONTAINERS = [
  { code: 'LOO', label: 'Loose' },
  { code: 'CAR', label: 'Cages / trolleys' },
  { code: 'BAG', label: 'Bags / sacks' },
  { code: 'PAL', label: 'Pallets' },
  { code: 'BOX', label: 'Crates / boxes' },
];

export const SECTIONS = [
  { id: 'general', label: 'General furniture and fittings', tone: 'general' },
  { id: 'seating_pops', label: 'Upholstered seating (POPs): keep unmixed, unload separately', tone: 'pops' },
  { id: 'wood_metal', label: 'Wood and metal', tone: 'general' },
  { id: 'paper_packaging', label: 'Paper, confidential, card, film, pallets', tone: 'general' },
  { id: 'electricals', label: 'Electricals (non-hazardous)', tone: 'weee' },
  { id: 'domestic', label: 'Domestic items', tone: 'general' },
  { id: 'hazardous_stop', label: 'STOP: hazardous. Do not load', tone: 'stop' },
];

// ---------- Nations ----------
const SCOTLAND = ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'ZE'];
const WALES = ['CF', 'LD', 'LL', 'NP', 'SA'];
const BORDER = { TD: 'scotland', CH: 'england', SY: 'england', HR: 'england', GL: 'england' };

export function postcodeArea(postcode) {
  const m = String(postcode || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2})\d/);
  return m ? m[1] : null;
}

// Returns { nation, certain } — border areas need a person to confirm.
export function nationFromPostcode(postcode) {
  const area = postcodeArea(postcode);
  if (!area) return { nation: null, certain: false };
  if (area === 'BT') return { nation: 'northern_ireland', certain: true };
  if (SCOTLAND.includes(area)) return { nation: 'scotland', certain: true };
  if (WALES.includes(area)) return { nation: 'wales', certain: true };
  if (BORDER[area]) return { nation: BORDER[area], certain: false };
  return { nation: 'england', certain: true };
}

export const regimeFor = (nation) => (nation === 'scotland' ? 'SC' : nation === 'northern_ireland' ? 'NI' : 'EW');

export const NATION_LABEL = { england: 'England', wales: 'Wales', scotland: 'Scotland', northern_ireland: 'Northern Ireland' };

// ---------- Items and streams ----------
export const premisesOf = (job) => job.premises || TRANSFEROR_TYPES[job.transferor_type]?.premises || 'commercial';

export function codeFor(item, premises) {
  return premises === 'domestic' ? (item.code_household || item.code_business) : (item.code_business || item.code_household);
}

export function descriptionFor(item, premises) {
  const d = premises === 'domestic' ? (item.note_description_household || item.note_description_business)
    : (item.note_description_business || item.note_description_household);
  return d || item.long_name || item.label;
}

// Standard descriptions for the waste streams a client signs for (List of Wastes wording,
// in plain terms). Item detail stays on each load line.
const STREAM_DESC = {
  '15 01 01': 'Paper and cardboard packaging', '15 01 02': 'Plastic packaging', '15 01 03': 'Wooden packaging (pallets)',
  '16 02 14': 'Discarded electrical equipment (non-hazardous)', '16 06 04': 'Alkaline batteries',
  '16 06 05': 'Other batteries (non-hazardous)', '17 06 04': 'Insulation materials (ceiling tiles)',
  '17 09 04': 'Mixed construction and demolition waste', '20 01 01': 'Paper and cardboard', '20 01 10': 'Clothes',
  '20 01 11': 'Textiles', '20 01 34': 'Batteries (non-hazardous)', '20 01 36': 'Discarded electrical equipment (non-hazardous)',
  '20 01 38': 'Wood', '20 01 39': 'Plastics', '20 01 40': 'Metals', '20 03 01': 'Mixed municipal waste',
  '20 03 07': 'Bulky waste (furniture and fittings)',
};
const POPS_DESC = 'domestic seating waste containing POPs';

export const isPopsSeating = (item) => item.section === 'seating_pops' || /containing POPs/i.test(item.note_description_business || '');

// Not every item exists for every kind of premises (e.g. partitions from a house).
export function availableFor(item, premises) {
  const c = String(codeFor(item, premises) || '').trim().toLowerCase();
  return !!c && c !== 'n/a' && item.status !== 'retired';
}

// Hazardous for this job: flagged hazardous, or its code for these premises is a
// hazardous (*) code. Some electricals are only hazardous from households.
export function hazardousFor(item, premises) {
  return !!item.hazardous || item.section === 'hazardous_stop' || String(codeFor(item, premises) || '').includes('*');
}

export function streamKey(item, premises) {
  return `${codeFor(item, premises)}${isPopsSeating(item) ? '|POPs' : ''}`;
}

export function streamDescription(item, premises) {
  if (isPopsSeating(item)) return POPS_DESC;
  const code = codeFor(item, premises);
  if (STREAM_DESC[code]) return STREAM_DESC[code];
  if (/\+/.test(code)) return `${descriptionFor(item, premises)} (mixed codes)`;
  return descriptionFor(item, premises);
}

// Streams a job could carry (everything that can go on a transfer note).
export function streamsFromItems(items, premises) {
  const map = new Map();
  for (const it of items) {
    if (!availableFor(it, premises) || hazardousFor(it, premises)) continue;
    const key = streamKey(it, premises);
    if (!map.has(key)) {
      map.set(key, { key, code: codeFor(it, premises), description: streamDescription(it, premises), pops: isPopsSeating(it),
        pops_chemicals: isPopsSeating(it) ? (it.pops_chemicals || 'DecaBDE, HBCDD, PentaBDE, TetraBDE') : null, examples: [] });
    }
    const s = map.get(key);
    if (s.examples.length < 4) s.examples.push(it.label);
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code) || a.description.localeCompare(b.description));
}

export const itemById = (settings) => new Map((settings.items || []).map((i) => [i.id, i]));

export const COUNTABLE = new Set(['each', 'position', 'column', 'bag', 'sack', 'bin', undefined, null, '']);

export function lineTotals(lines, items, premises) {
  const byId = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  let count = 0, kg = 0, cuft = 0, kgUnknown = false;
  for (const l of lines) {
    const it = byId.get(l.item_id);
    if (!it) continue;
    if (COUNTABLE.has(it.count_unit)) count += l.count;
    if (it.std_kg == null) kgUnknown = true; else kg += l.count * it.std_kg;
    if (it.cu_ft != null) cuft += l.count * it.cu_ft;
  }
  return { count, kg: Math.round(kg), cuft: Math.round(cuft), kgUnknown };
}

// Collapse a load's tally into note lines.
export function loadLines(load, items, premises) {
  const byId = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  const out = [];
  for (const [id, count] of Object.entries(load.counts || {})) {
    if (!count) continue;
    const it = byId.get(id);
    if (!it) continue;
    out.push({
      item_id: id, label: it.label, long_name: it.long_name || it.label, section: it.section,
      code: codeFor(it, premises), description: descriptionFor(it, premises),
      stream_key: streamKey(it, premises), stream_description: streamDescription(it, premises),
      pops: isPopsSeating(it), pops_chemicals: isPopsSeating(it) ? (it.pops_chemicals || 'DecaBDE, HBCDD, PentaBDE, TetraBDE') : null,
      count, count_unit: it.count_unit || 'each',
      std_kg: it.std_kg ?? null, kg_est: it.std_kg == null ? null : Math.round(count * it.std_kg),
      cu_ft: it.cu_ft == null ? null : Math.round(count * it.cu_ft * 10) / 10,
      destination_type: it.destination_type || null,
      hazardous: hazardousFor(it, premises),
    });
  }
  for (const u of load.unlisted || []) {
    out.push({ item_id: 'UNLISTED', label: `Not on list: ${u.text}`, long_name: u.text, section: 'general',
      code: 'TO CONFIRM', description: `Unlisted item: ${u.text} (code to be confirmed by the office)`, pops: false,
      stream_key: `UNLISTED|${u.text}`, stream_description: `Unlisted item: ${u.text} (code to be confirmed by the office)`,
      count: u.count || 1, count_unit: 'each', std_kg: null, kg_est: null, cu_ft: u.cu_ft ?? null, review: true });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.label.localeCompare(b.label));
}

export function streamTotals(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = l.stream_key || `${l.code}|${l.description}`;
    if (!map.has(key)) map.set(key, { key, code: l.code, description: l.stream_description || l.description, pops: l.pops, pops_chemicals: l.pops_chemicals, count: 0, measured: [], kg_est: null, kgUnknown: false, cu_ft: 0 });
    const s = map.get(key);
    if (COUNTABLE.has(l.count_unit)) s.count += l.count;
    else s.measured.push(`${l.count} ${l.count_unit}`);
    if (l.kg_est == null) s.kgUnknown = true; else s.kg_est = (s.kg_est || 0) + l.kg_est;
    s.cu_ft = Math.round((s.cu_ft + (l.cu_ft || 0)) * 10) / 10;
  }
  return [...map.values()];
}

// "12" or "12 + 30 cu ft" or "30 cu ft" — how a stream's quantity reads on screens and notes.
export function quantityText(s) {
  const parts = [];
  if (s.count || !s.measured?.length) parts.push(String(s.count));
  if (s.measured?.length) parts.push(...s.measured);
  return parts.join(' + ');
}

// ---------- Desk checks (before a job is sent to a phone) ----------
export function deskChecks(job, settings) {
  const out = [];
  const block = (rule, msg) => out.push({ level: 'block', rule, msg });
  const warn = (rule, msg) => out.push({ level: 'warn', rule, msg });
  const type = TRANSFEROR_TYPES[job.transferor_type];
  const reg = settings?.company?.registration;

  if (!settings?.company?.legal_name) block('company', 'Company details are missing from Settings.');
  if (!reg?.number) block('registration', 'Our carrier registration number is missing from Settings.');
  if (!settings?.items?.length) block('items', 'No item list is loaded in Settings.');
  if (!job.ref) block('ref', 'Add the job or quote reference.');
  if (!type) block('transferor', 'Choose who is handing over the waste.');
  if (!job.collection?.postcode) block('postcode', 'Add the collection postcode.');
  if (!job.collection?.address) block('address', 'Add the collection address.');
  if (!job.nation) block('nation', 'Confirm which nation the collection is in.');
  if (job.nation === 'northern_ireland') block('nation', 'Northern Ireland work needs NIEA registration and paperwork; this app does not cover it yet.');
  if (type && job.transferor_type !== 'householder') {
    if (!job.producer?.name) block('producer', 'Add the waste producer (who the waste belongs to), not just the billing account.');
    if (!job.producer?.address) block('producer_address', "Add the producer's address.");
    if (type.premises === 'commercial' && !/^\d{4,5}$/.test(String(job.producer?.sic || '').trim()))
      block('sic', "Add the producer's SIC 2007 code (4 or 5 digits). Companies House shows it for companies.");
    if (!job.signatory?.name) block('signatory', 'Name the person who will sign for the client.');
    if (!job.signatory?.email) warn('signatory_email', "No email for the client's signatory: the note will have to be passed on by hand.");
  }
  if (job.transferor_type === 'fm_for_occupier' && !job.fm?.name) warn('fm', 'Add the FM contractor who placed the work.');
  if (!job.planned_sites?.length) block('sites', 'Choose at least one tip site for this job.');
  if (!job.expected_streams?.length) block('streams', 'Tick the waste expected on this job so the client can sign the description.');

  const sites = (settings?.sites || []).filter((s) => job.planned_sites?.includes(s.id));
  for (const s of sites) {
    if (!s.permit_number) warn('site_permit', `${s.name}: permit number not recorded. Check it on the public register before loading.`);
  }
  const wantsPops = (job.expected_streams || []).some((k) => /containing POPs/i.test(k));
  if (wantsPops && !sites.some((s) => (s.accepts || []).includes('pops_incineration')))
    warn('site_pops', 'Upholstered seating is expected but no chosen site is marked as taking POPs seating for incineration.');
  if (job.nation === 'scotland') warn('scotland', 'Scotland: a client signature is needed for every load, and screens, tubes and fridges must stay on site (special waste).');
  if (job.nation === 'wales') warn('wales', 'Wales: waste wood cannot go to landfill and small electricals must be kept separate.');
  if (reg?.expiry && job.date && job.date > reg.expiry) block('registration_expiry', 'Our registration expires before this job date.');
  return out;
}

export const blocking = (checks) => checks.filter((c) => c.level === 'block');

// ---------- Load checks (before a load can be closed) ----------
export function loadChecks(job, load, settings, lines) {
  const out = [];
  const signedKeys = new Set(signedStreamKeys(job));
  const missing = [...new Set(lines.filter((l) => l.item_id !== 'UNLISTED' && !signedKeys.has(l.stream_key)).map((l) => `${l.code} ${l.stream_description}`))];
  if (!job.signoff) out.push({ level: 'block', rule: 'signoff', msg: 'The client has not signed the waste description yet.' });
  else if (missing.length) out.push({ level: 'block', rule: 'addendum', msg: `Not on the signed description: ${missing.join('; ')}. Get the client to sign an addition.`, missing });
  if (!lines.length) out.push({ level: 'block', rule: 'empty', msg: 'Nothing has been counted on this load.' });
  const haz = lines.filter((l) => l.hazardous).map((l) => l.label);
  if (haz.length) out.push({ level: 'block', rule: 'hazardous', msg: `Hazardous on this job, so it cannot go on this load: ${haz.join(', ')}. Take it off and log it as found hazardous.` });
  if (!load.vehicle_reg) out.push({ level: 'block', rule: 'vehicle', msg: 'Add the vehicle registration.' });
  if (!load.destination_id) out.push({ level: 'block', rule: 'destination', msg: 'Choose where this load is going.' });
  const site = (settings.sites || []).find((s) => s.id === load.destination_id);
  if (site?.accepts?.length) {
    const refused = [...new Set(lines.filter((l) => l.destination_type && !siteTakes(site, l.destination_type)).map((l) => l.label))];
    if (refused.length) out.push({ level: 'warn', rule: 'site_accepts', msg: `${site.name} is not marked as taking: ${refused.join(', ')}.` });
  }
  if (lines.some((l) => l.pops) && !load.pops_unmixed) out.push({ level: 'block', rule: 'pops', msg: 'Confirm the upholstered seating is kept unmixed on the van.' });
  const cap = vehicleCapacity(load, settings);
  const cuft = lines.reduce((a, l) => a + (l.cu_ft || 0), 0);
  if (cap && cuft > cap) out.push({ level: 'warn', rule: 'capacity', msg: `Counted items come to about ${Math.round(cuft)} cu ft, more than this vehicle holds (${cap}). Check the counts.` });
  if (job.nation === 'scotland' && !load.client_signature) out.push({ level: 'block', rule: 'scotland_sig', msg: 'Scotland: the client must sign for this load.' });
  if (lines.some((l) => l.review)) out.push({ level: 'warn', rule: 'unlisted', msg: 'Unlisted items need a waste code from the office before the note is final.' });
  return out;
}

// Which site "accepts" keys satisfy an item's destination type.
const ACCEPTS = {
  aatf: ['aatf', 'weee'], lamp: ['lamp', 'aatf', 'weee'], battery: ['battery', 'aatf', 'weee'],
  general_transfer: ['general_transfer'], pops_incineration: ['pops_incineration'], metal: ['metal'], wood: ['wood', 'general_transfer'],
  paper: ['paper', 'general_transfer'], packaging: ['packaging', 'paper', 'general_transfer'], confidential: ['confidential'],
  mattress: ['mattress', 'general_transfer'], cable: ['cable', 'metal', 'aatf', 'weee'],
};
export const siteTakes = (site, destinationType) => (ACCEPTS[destinationType] || [destinationType]).some((k) => (site.accepts || []).includes(k));

export function vehicleCapacity(load, settings) {
  const t = (settings.vehicle_types || []).find((v) => v.id === load.vehicle_type);
  return t?.usable_cuft || null;
}

export function signedStreamKeys(job) {
  const keys = [...(job.signoff?.streams || []).map((s) => s.key)];
  for (const a of job.addenda || []) keys.push(...a.streams.map((s) => s.key));
  return keys;
}

// ---------- Honesty flags (office side) ----------
export function honestyFlags(note, settings) {
  const flags = [];
  const loads = note.transfer?.loads || [];
  const lastClose = Math.max(...loads.map((l) => Date.parse(l.closed_at) || 0));
  const taps = loads.flatMap((l) => (l.tally_times || []));
  if (taps.length > 10 && taps.every((t) => lastClose - Date.parse(t) < 5 * 60 * 1000) && loads.length > 1)
    flags.push('All counts were entered in the last five minutes of the job.');
  const allLines = loads.flatMap((l) => l.lines);
  const cu = allLines.reduce((a, l) => a + (l.cu_ft || 0), 0);
  const mixed = allLines.filter((l) => /mixed|bulky/i.test(l.label)).reduce((a, l) => a + (l.cu_ft || 0), 0);
  if (cu > 0 && mixed / cu > 0.3 && note.job?.job_type === 'office') flags.push(`"Mixed bulky" is ${Math.round((mixed / cu) * 100)}% of the volume on an office clearance.`);
  for (const l of loads) {
    const t = (settings?.vehicle_types || []).find((v) => v.id === l.vehicle_type);
    const lc = l.lines.reduce((a, x) => a + (x.cu_ft || 0), 0);
    if (t?.usable_cuft && lc > t.usable_cuft) flags.push(`Load ${l.ref}: about ${Math.round(lc)} cu ft counted on a ${t.label} (${t.usable_cuft} cu ft).`);
  }
  if (note.survey_matched_exactly) flags.push('Survey counts were accepted with no changes at all.');
  if (allLines.some((l) => l.review)) flags.push('Unlisted items need a waste code.');
  return flags;
}
