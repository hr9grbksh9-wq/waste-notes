// Two files for Zoho CRM's own Import, from the office register: one row per note,
// one row per item line. The headers are the Zoho field labels, so the Import wizard
// maps the columns itself. Times are UK time as "yyyy-MM-dd HH:mm:ss" (pick that
// format in the wizard). Import the notes file first, then the lines file.

const NATION = { england: 'England', wales: 'Wales', scotland: 'Scotland' };
const TRANSFEROR = {
  business_occupier: 'Business occupier', fm_for_occupier: 'FM for occupier', landlord_agent_executor: 'Landlord, agent or executor',
  householder: 'Householder', own_waste: 'Our own waste',
};
const UK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function ukTime(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(UK.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// Zoho's API takes ISO times with an offset.
export const apiTime = (iso) => (iso ? new Date(iso).toISOString().replace(/\.\d{3}Z$/, '+00:00') : '');

const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);

export function noteRow(entry, tipByLoad = new Map(), time = ukTime) {
  const r = entry.record;
  const loads = r.transfer.loads;
  const tips = loads.map((l) => tipByLoad.get(l.ref)).filter(Boolean);
  const reuse = r.annex?.reuse || [];
  const addenda = r.addenda || [];
  return {
    'Waste Transfer Note Name': r.number,
    'Job Ref': r.job.ref, 'Depot': r.job.depot,
    'Nation': NATION[r.nation] || '',
    'Note Kind': r.kind === 'household_receipt' ? 'Household receipt' : 'Waste transfer note',
    'Transferor Type': TRANSFEROR[r.transferor.type] || '',
    'Producer': r.transferor.name, 'Producer SIC': r.transferor.sic, 'Work Placed By': r.transferor.fm_name,
    'Collection Address': r.transfer.place.address, 'Collection Postcode': r.transfer.place.postcode,
    'First Load At': time(r.transfer.first_at), 'Issued At': time(r.issued_at),
    'Loads': loads.length, 'Items': sum(r.waste.map((w) => w.count)),
    'Estimated Kg': sum(r.waste.map((w) => w.kg_est)), 'Cu Ft': Math.round(sum(r.waste.map((w) => w.cu_ft)) * 10) / 10,
    'Waste Codes': r.waste.map((w) => `${w.code} ${w.description}: ${w.count}`).join(' | '),
    'POPs Seating': r.waste.some((w) => w.pops),
    'Hazardous Left On Site': (r.annex?.hazards_left || []).map((h) => `${h.count || 1} x ${h.type}`).join('; '),
    'Client Signatory': r.signoff?.client_name, 'Client Signed At': time(r.signoff?.signed_at),
    'Hierarchy Declaration': !!r.declarations?.hierarchy,
    'Item List Version': r.item_list_version, 'Fingerprint': r.seal?.fingerprint,
    'Seal Check': entry.seal_ok ? 'Checked OK' : 'Broken',
    'Review Needed': !!r.review_needed, 'Office Copy Received': time(entry.imported_at),
    'Additions': addenda.length,
    'Additions Detail': addenda.map((a) => `${ukTime(a.signed_at)} ${a.client_name || ''}: ${a.streams.map((s) => `${s.code} ${s.description}`).join('; ')}`).join(' | '),
    'Reuse Items': sum(reuse.map((x) => x.count)),
    'Reuse Detail': reuse.map((x) => `${x.count} x ${x.label} (load ${x.load})`).join('; '),
    'Tip Weight Kg': tips.some((t) => t.weight_kg != null) ? sum(tips.map((t) => t.weight_kg)) : '',
    'Tip Tickets': tips.map((t) => t.ticket_no).filter(Boolean).join('; '),
  };
}

export function lineRows(entry, time = ukTime) {
  const r = entry.record;
  return r.transfer.loads.flatMap((l) => l.lines.map((x, i) => ({
    'Waste Note Line Name': `${r.number} ${l.ref} ${i + 1}`,
    'Waste Transfer Note': r.number,
    'Load Ref': l.ref, 'Load Left At': time(l.closed_at), 'Vehicle Reg': l.vehicle_reg,
    'Destination': l.destination?.name, 'Destination Permit': l.destination?.permit_number,
    'Load Signed By': l.client_signature?.name, 'Load Signed At': time(l.client_signature?.at),
    'Item': x.label, 'Item ID': x.item_id, 'Waste Code': x.code, 'Description': x.stream_description || x.description,
    'Quantity': x.count, 'Unit': x.count_unit || 'each', 'Estimated Kg': x.kg_est, 'Cu Ft': x.cu_ft, 'POPs': !!x.pops,
  })));
}

function csv(rows) {
  if (!rows.length) return '';
  // Leave out columns that are empty in every row: Zoho's Import stops to ask for the
  // number format of an empty number column (e.g. tip weights when there are none).
  const filled = (v) => v !== undefined && v !== null && v !== '';
  const cols = Object.keys(rows[0]).filter((c) => rows.some((r) => filled(r[c])));
  const cell = (v) => {
    const s = typeof v === 'boolean' ? String(v) : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols, ...rows.map((r) => cols.map((c) => r[c]))].map((r) => r.map(cell).join(',')).join('\n');
}

// entries: office register entries for notes ({ record, seal_ok, imported_at }).
export function zohoImportFiles(entries, tipByLoad = new Map()) {
  return {
    notes: csv(entries.map((e) => noteRow(e, tipByLoad))),
    lines: csv(entries.flatMap((e) => lineRows(e))),
  };
}

// For automatic filing: the phone's office copy carries this beside the PDF and the
// sealed record, so Zoho only copies fields across. Keys are Zoho API names (the
// label with spaces as underscores; the record name is "Name"), times are ISO, and
// empty values are left out. Seal Check and Office Copy Received are set by Zoho.
const apiKey = (label) => (/ Name$/.test(label) && /^Waste (Transfer Note|Note Line) Name$/.test(label) ? 'Name' : label.replace(/ /g, '_'));
const apiMap = (row, skip = []) => Object.fromEntries(Object.entries(row)
  .filter(([k, v]) => !skip.includes(k) && v !== undefined && v !== null && v !== '')
  .map(([k, v]) => [apiKey(k), v]));

export function zohoPayload(record) {
  const entry = { record };
  return {
    kind: 'waste-notes-zoho', v: 1, number: record.number, fingerprint: record.seal?.fingerprint || null,
    note: apiMap(noteRow(entry, new Map(), apiTime), ['Seal Check', 'Office Copy Received', 'Tip Weight Kg', 'Tip Tickets']),
    lines: lineRows(entry, apiTime).map((l) => apiMap(l, ['Waste Transfer Note'])),
  };
}
