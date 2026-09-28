// Core tests: pack round-trip, seal/verify, rules, note build and PDF output.
// Run: node test/core.test.mjs   (writes test/out/sample-note.pdf)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodePack, decodePack, extractPack } from '../js/pack.js';
import { sealRecord, verifySeal, canonical } from '../js/seal.js';
import { nationFromPostcode, deskChecks, blocking, loadChecks, loadLines, streamsFromItems, itemById, premisesOf, honestyFlags } from '../js/rules.js';
import { buildJobNote, renderNotePdf } from '../js/notes.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const sigs = JSON.parse(readFileSync(new URL('./sigs.json', import.meta.url)));
const settings = JSON.parse(readFileSync(new URL('../settings.example.json', import.meta.url)));

// --- pack
const packed = await encodePack({ hello: 'world', n: [1, 2, 3] });
ok((await decodePack(packed)).hello === 'world', 'pack round-trip');
ok(extractPack(`https://x.test/app/#pack=${packed}`).data === packed, 'extract pack from link');

// --- seal
const rec = await sealRecord({ b: 2, a: { z: 1, y: [3, { q: 1 }] } });
ok((await verifySeal(rec)).ok, 'seal verifies');
ok(!(await verifySeal({ ...rec, b: 3 })).ok, 'tamper detected');
ok(canonical({ b: 1, a: 2 }) === '{"a":2,"b":1}', 'canonical ordering');

// --- nations
ok(nationFromPostcode('EH12 9EB').nation === 'scotland', 'EH is Scotland');
ok(nationFromPostcode('G1 1AA').nation === 'scotland', 'G is Scotland');
ok(nationFromPostcode('GL1 1AA').nation === 'england' && !nationFromPostcode('GL1 1AA').certain, 'GL border uncertain');
ok(nationFromPostcode('CF10 1AA').nation === 'wales', 'CF is Wales');
ok(nationFromPostcode('CW9 7LP').nation === 'england', 'CW is England');

// --- desk checks
const job = {
  id: 'job-1', ref: 'Q58490', ref_prefix: 'DBY', depot: 'Derby', date: '2026-09-29', job_type: 'office',
  transferor_type: 'business_occupier', nation: 'england',
  producer: { name: 'Example Client Ltd', address: '1 High Street, Derby', postcode: 'DE1 1AA', sic: '70100' },
  collection: { address: '1 High Street, Derby', postcode: 'DE1 1AA' },
  signatory: { name: 'Pat Client', role: 'Facilities manager', email: 'pat@example.com' },
  planned_sites: [settings.sites[0].id, settings.sites[1].id],
  expected_streams: [],
};
const premises = premisesOf(job);
const streams = streamsFromItems(settings.items, premises);
job.expected_streams = streams.map((s) => s.key);
const checks = deskChecks(job, settings);
ok(blocking(checks).length === 0, `desk checks pass (${checks.map((c) => c.rule).join(',') || 'none'})`);
ok(blocking(deskChecks({ ...job, producer: { ...job.producer, sic: '' } }, settings)).some((c) => c.rule === 'sic'), 'missing SIC blocks');

// --- signoff + loads
job.signoff = {
  streams: streams, hierarchy: true, accurate: true, client_name: 'Pat Client', client_role: 'Facilities manager',
  client_signature: { data: sigs.a, w: 480, h: 160 }, crew_name: 'Sam Crew', crew_signature: { data: sigs.b, w: 480, h: 160 },
  signed_at: '2026-09-29T08:05:00Z', gps: { lat: 52.9225, lng: -1.4746 },
};
job.signoff = await sealRecord(job.signoff);
const items = itemById(settings);
const ids = settings.items.map((i) => i.id);
job.loads = [
  { ref: 'DBY-000123', started_at: '2026-09-29T08:10:00Z', closed_at: '2026-09-29T09:40:00Z', vehicle_reg: 'AB12 CDE', vehicle_type: '18T', driver: 'Sam Crew',
    destination_id: settings.sites[0].id, counts: { [ids[0]]: 40, [ids[1]]: 10, [ids[2]]: 12 }, containers: { general: { code: 'LOO', label: 'Loose' } }, pops_unmixed: true,
    reuse: { [ids[0]]: 4 }, tally_times: ['2026-09-29T08:20:00Z', '2026-09-29T09:30:00Z'] },
  { ref: 'DBY-000124', started_at: '2026-09-29T10:00:00Z', closed_at: '2026-09-29T11:20:00Z', vehicle_reg: 'AB12 CDE', vehicle_type: '18T', driver: 'Sam Crew',
    destination_id: settings.sites[1].id, counts: { [ids[3]]: 30 }, containers: { pops: { code: 'BAG', label: 'Bags / sacks' } }, pops_unmixed: true,
    unlisted: [{ text: 'Old safe, empty', count: 1 }], tally_times: ['2026-09-29T10:30:00Z'] },
];
job.hazards = [{ at: '2026-09-29T09:00:00Z', type: 'Screens and monitors', count: 20, where: 'Floor 2 comms room', tagged: true }];
const lines1 = loadLines(job.loads[0], items, premises);
ok(loadChecks(job, job.loads[0], settings, lines1).filter((c) => c.level === 'block').length === 0, 'load 1 passes checks');
ok(loadChecks({ ...job, signoff: null }, job.loads[0], settings, lines1).some((c) => c.rule === 'signoff'), 'unsigned load blocks');

// --- note
const note = await buildJobNote(job, settings);
ok((await verifySeal(note)).ok, 'note seal verifies');
ok(note.transfer.loads.length === 2 && note.waste.length > 0, `note has ${note.transfer.loads.length} loads, ${note.waste.length} streams`);
ok(note.review_needed === true, 'unlisted item flags review');
console.log('honesty flags:', honestyFlags(note, settings));
const pdf = renderNotePdf(note, settings);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/sample-note.pdf', import.meta.url), pdf);
ok(pdf.length > 2000 && String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-', `pdf written (${pdf.length} bytes)`);
writeFileSync(new URL('./out/sample-note.json', import.meta.url), JSON.stringify(note, null, 1));

// household receipt
const hh = await buildJobNote({ ...job, transferor_type: 'householder', premises: 'domestic', notes: [] }, settings);
writeFileSync(new URL('./out/sample-household.pdf', import.meta.url), renderNotePdf(hh, settings));
ok(hh.kind === 'household_receipt', 'householder gets a receipt');
ok(hh.declarations.hierarchy === null, 'householder is not asked for the hierarchy declaration (a business duty)');

// scotland
const sc = await buildJobNote({ ...job, nation: 'scotland' }, settings);
writeFileSync(new URL('./out/sample-scotland.pdf', import.meta.url), renderNotePdf(sc, settings));
ok(sc.regime === 'SC' && sc.declarations.hierarchy === null, 'Scotland drops hierarchy declaration');

// hazardous by premises: a PC from a house is hazardous (20 01 35*), from an office it is not
{
  const { hazardousFor } = await import('../js/rules.js');
  const pc = { ...settings.items.find((i) => i.id === 'D04'), code_household: '20 01 35* + 20 01 36' };
  ok(!hazardousFor(pc, 'commercial') && hazardousFor(pc, 'domestic'), 'household PC is hazardous, office PC is not');
  const s2 = { ...settings, items: settings.items.map((i) => (i.id === 'D04' ? pc : i)) };
  const hjob = { ...job, transferor_type: 'landlord_agent_executor', premises: 'domestic' };
  const hl = loadLines({ counts: { D04: 2 } }, itemById(s2), 'domestic');
  ok(loadChecks(hjob, { ...job.loads[0], counts: { D04: 2 } }, s2, hl).some((c) => c.rule === 'hazardous'), 'hazardous line blocks the load');
}

// Zoho import files: Zoho's field labels, one row per note and per item line, UK times
{
  const { zohoImportFiles, noteRow, lineRows, ukTime } = await import('../js/zoho.js');
  const entry = { record: note, seal_ok: true, imported_at: '2026-09-29T12:00:00Z' };
  const files = zohoImportFiles([entry]);
  ok(files.notes.split('\n')[0].startsWith('Waste Transfer Note Name,Job Ref,') && files.notes.split('\n').length === 2, 'zoho notes file: Zoho labels, one row per note');
  ok(!files.notes.split('\n')[0].includes('Tip Weight Kg'), 'zoho notes file leaves out columns empty in every row (no tip weights yet)');
  const nLines = note.transfer.loads.reduce((a, l) => a + l.lines.length, 0);
  ok(files.lines.split('\n').length === nLines + 1 && lineRows(entry)[0]['Waste Transfer Note'] === note.number, `zoho lines file: one row per item line (${nLines}), linked by note number`);
  const row = noteRow(entry);
  ok(row['First Load At'] === '2026-09-29 10:40:00' && ukTime('2026-12-01T09:00:00Z') === '2026-12-01 09:00:00', 'zoho times are UK time (BST and GMT)');
  ok(row['Loads'] === 2 && row['Reuse Items'] === 4 && row['Seal Check'] === 'Checked OK' && row['Office Copy Received'] === '2026-09-29 13:00:00', 'zoho note row: loads, reuse, seal, office copy time');
  const add = noteRow({ record: { ...note, addenda: [{ signed_at: '2026-09-29T09:00:00Z', client_name: 'Pat Client', streams: [{ code: '20 01 40', description: 'Metals' }] }] }, seal_ok: false });
  ok(add['Additions'] === 1 && add['Additions Detail'] === '2026-09-29 10:00:00 Pat Client: 20 01 40 Metals' && add['Seal Check'] === 'Broken', 'zoho note row: signed additions and a broken seal');
  const scl = lineRows({ record: { ...note, transfer: { ...note.transfer, loads: [{ ...note.transfer.loads[0], client_signature: { name: 'Pat Client', at: '2026-09-29T09:35:00Z' } }] } } })[0];
  ok(scl['Load Signed By'] === 'Pat Client' && scl['Load Signed At'] === '2026-09-29 10:35:00', 'zoho line row: per-load client signature (Scotland)');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
