// Builds the sealed note record for a job, and renders it to PDF.
import { PdfDoc, Flow, A4, hexToRgb, textWidth } from './pdf.js';
import { sealRecord, shortPrint } from './seal.js';
import { TRANSFEROR_TYPES, NATION_LABEL, premisesOf, itemById, loadLines, lineTotals, streamTotals, regimeFor, quantityText } from './rules.js';

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtKg = (v, unknown) => (v == null ? 'n/k' : `${v.toLocaleString('en-GB')}${unknown ? '+' : ''}`);
const addr = (a) => [a?.address, a?.postcode].filter(Boolean).join(', ');

export function noteNumber(job) {
  const seq = (job.notes || []).length + 1;
  return `${job.ref_prefix || 'WN'}-${String(job.ref).replace(/[^A-Za-z0-9-]/g, '')}-${seq}`;
}

export async function buildJobNote(job, settings) {
  const premises = premisesOf(job);
  const items = itemById(settings);
  const type = TRANSFEROR_TYPES[job.transferor_type];
  const already = new Set((job.notes || []).flatMap((n) => n.load_refs || []));
  const closed = (job.loads || []).filter((l) => l.closed_at && !already.has(l.ref));
  const loads = closed.map((l) => {
    const lines = loadLines(l, items, premises);
    const site = (settings.sites || []).find((s) => s.id === l.destination_id) || {};
    const vt = (settings.vehicle_types || []).find((v) => v.id === l.vehicle_type) || {};
    return {
      ref: l.ref, started_at: l.started_at, closed_at: l.closed_at,
      vehicle_reg: l.vehicle_reg, vehicle_type: l.vehicle_type || null, vehicle_label: vt.label || null, driver: l.driver || null,
      destination: { id: site.id || null, name: site.name || null, address: site.address || null, postcode: site.postcode || null, permit_number: site.permit_number || null },
      containers: l.containers || {}, pops_unmixed: !!l.pops_unmixed,
      lines, totals: lineTotals(lines.filter((x) => x.item_id !== 'UNLISTED').map((x) => ({ item_id: x.item_id, count: x.count })), items, premises),
      reuse: Object.entries(l.reuse || {}).filter(([, c]) => c).map(([id, count]) => ({ item_id: id, label: items.get(id)?.label || id, count })),
      photo: l.photo || null, client_signature: l.client_signature || null,
      crew_confirm: l.crew_confirm || null, tally_times: l.tally_times || [],
    };
  });
  const allLines = loads.flatMap((l) => l.lines);
  const company = settings.company || {};
  const note = {
    schema: 'waste-notes/1',
    kind: type?.needsNote === false ? 'household_receipt' : 'wtn',
    number: noteNumber(job),
    regime: regimeFor(job.nation), nation: job.nation,
    issued_at: new Date().toISOString(),
    job: { id: job.id, ref: job.ref, depot: job.depot || null, date: job.date || null, job_type: job.job_type || null, premises },
    transfer: {
      place: { address: job.collection?.address || '', postcode: job.collection?.postcode || '' },
      first_at: loads[0]?.closed_at || null,
      series: loads.length > 1,
      loads,
    },
    transferor: {
      type: job.transferor_type, type_label: type?.label || '', is_producer: !!type?.isProducer,
      name: job.producer?.name || job.signatory?.name || '', address: job.producer?.address || job.collection?.address || '',
      postcode: job.producer?.postcode || job.collection?.postcode || '', sic: job.producer?.sic || null,
      company_number: job.producer?.company_number || null, fm_name: job.fm?.name || null,
    },
    transferee: {
      legal_name: company.legal_name, trading_name: company.trading_name || null, address: company.address, postcode: company.postcode,
      registration: company.registration || {}, sic: company.sic || null,
    },
    waste: streamTotals(allLines),
    declarations: {
      hierarchy: regimeFor(job.nation) === 'EW' ? !!job.signoff?.hierarchy : null,
      description_accurate: !!job.signoff?.accurate,
    },
    signoff: job.signoff || null,
    addenda: job.addenda || [],
    quantities_basis: `Quantities are item counts recorded as each load was loaded. Weights are estimates: count x standard weight from item list ${settings.items_version || 'unversioned'}. Volumes are cu ft as loaded.`,
    item_list_version: settings.items_version || null,
    annex: {
      reuse: loads.flatMap((l) => l.reuse.map((r) => ({ ...r, load: l.ref }))),
      hazards_left: (job.hazards || []).map((h) => ({ at: h.at, type: h.type, count: h.count, where: h.where, tagged: h.tagged, photo: h.photo || null })),
    },
    load_refs: loads.map((l) => l.ref),
    review_needed: allLines.some((l) => l.review),
  };
  return sealRecord(note);
}

// ---------- PDF ----------
export function renderNotePdf(note, settings) {
  const brand = settings?.company?.brand || {};
  const ink = hexToRgb(brand.primary || '#404446');
  const gold = hexToRgb(brand.accent || '#DDBD5A');
  const household = note.kind === 'household_receipt';
  const title = household ? 'Household waste collection receipt' : 'Waste transfer note';
  const doc = new PdfDoc({ title: `${title} ${note.number}`, author: note.transferee?.legal_name || '' });
  const flow = new Flow(doc, { margin: 40, top: 92, bottom: 70, theme: { accent: ink } });

  const header = () => {
    doc.rect(0, 0, A4.w, 64, { fill: ink });
    doc.rect(0, 64, A4.w, 3, { fill: gold });
    doc.text(40, 30, (settings?.company?.display_name || note.transferee?.trading_name || note.transferee?.legal_name || '').toUpperCase(), { size: 9, bold: true, color: gold });
    doc.text(40, 50, title.toUpperCase(), { size: 16, bold: true, color: [1, 1, 1] });
    const right = `No. ${note.number}`;
    doc.text(A4.w - 40 - textWidth(right, 11, true), 30, right, { size: 11, bold: true, color: [1, 1, 1] });
    const nat = `${NATION_LABEL[note.nation] || ''} ${note.regime === 'SC' ? '· SEPA' : ''}`.trim();
    doc.text(A4.w - 40 - textWidth(nat, 9), 50, nat, { size: 9, color: [1, 1, 1] });
  };
  header();
  flow.onNewPage = header;

  const reg = note.transferee?.registration || {};
  const regLine = [reg.authority, reg.tier, reg.number].filter(Boolean).join(' · ');

  if (household) {
    flow.para('You do not need a waste transfer note for your own household waste. You do need to check it goes to a registered waste carrier. This receipt shows who took it, what was taken and where it is going.', { size: 9.5 });
    flow.heading('Collected by');
    flow.kv([
      ['Company', [note.transferee.legal_name, note.transferee.trading_name && `trading as ${note.transferee.trading_name}`].filter(Boolean).join(', ')],
      ['Address', addr(note.transferee)],
      ['Registered carrier', regLine],
      ['Check the register', 'environment.data.gov.uk/public-register (search our registration number)'],
    ]);
    flow.heading('Collected from');
    flow.kv([['Address', addr(note.transfer.place)], ['Collected', fmtTime(note.transfer.first_at)]]);
  } else {
    // 1. The waste
    flow.heading('1  The waste');
    flow.table(
      [{ title: 'Waste code', width: 0.14 }, { title: 'Description', width: 0.46 }, { title: 'Quantity', width: 0.14, align: 'right' }, { title: 'Est. kg', width: 0.12, align: 'right' }, { title: 'cu ft', width: 0.14, align: 'right' }],
      note.waste.map((s) => [s.code, s.description + (s.pops && s.pops_chemicals ? ` (POPs: ${s.pops_chemicals})` : ''), quantityText(s), fmtKg(s.kg_est, s.kgUnknown), String(s.cu_ft)]),
    );
    const containers = [...new Set(note.transfer.loads.flatMap((l) => Object.values(l.containers || {}).map((c) => c.label || c)))];
    flow.kv([
      ['How it is contained', containers.length ? containers.join(', ') : 'Loose'],
      ['Quantity basis', note.quantities_basis],
    ], { labelWidth: 120 });
    if (note.waste.some((s) => s.pops)) {
      flow.para('Upholstered seating containing POPs is kept unmixed with other waste during carriage, unloaded separately, and goes only to an incinerator authorised to take POPs waste.', { size: 8.5, bold: true });
    }

    // 2. Transferor
    flow.heading('2  Handed over by (transferor)');
    const t = note.transferor;
    flow.kv([
      ['Name', t.name],
      ['Address', [t.address, t.postcode].filter(Boolean).join(', ')],
      ['SIC code (2007)', t.sic || (note.job.premises === 'domestic' ? 'Not applicable (domestic property)' : 'Not given')],
      ['They are', t.is_producer ? 'The producer of the waste' : 'The current holder of the waste (not the producer)'],
      ...(t.fm_name ? [['Work placed by', t.fm_name]] : []),
      ...(t.company_number ? [['Company number', t.company_number]] : []),
    ]);

    // 3. Transferee
    flow.heading('3  Collected by (transferee)');
    flow.kv([
      ['Name', [note.transferee.legal_name, note.transferee.trading_name && `trading as ${note.transferee.trading_name}`].filter(Boolean).join(', ')],
      ['Address', addr(note.transferee)],
      ['They are', `A registered waste carrier${/broker/i.test((reg.roles || []).join(' ')) ? ', broker and dealer' : ''}`],
      ['Registration', regLine],
    ]);

    // 4. The transfer
    flow.heading('4  The transfer');
    flow.kv([
      ['Place of transfer', addr(note.transfer.place)],
      ['Date and time', `${fmtTime(note.transfer.first_at)}${note.transfer.loads.length > 1 ? ` (first of ${note.transfer.loads.length} loads, see schedule)` : ''}`],
      ['Broker or dealer', 'None: collected and carried by the transferee'],
    ]);
    if (note.transfer.loads.length > 1) {
      flow.para(note.regime === 'SC'
        ? 'This note covers several loads of the waste described above between the same parties. Each load is listed in the schedule with its own details and signatures.'
        : 'This note covers a series of loads of the waste described above between the same parties. The transfer is treated as taking place at the first load (Environmental Protection Act 1990, s34(4A)(b)). Each load is listed in the schedule.', { size: 8.5, color: [0.35, 0.35, 0.35] });
    }

    // 5. Declarations
    flow.heading('5  Declarations');
    const decl = [];
    if (note.regime === 'EW') decl.push(`${note.declarations.hierarchy ? '[X]' : '[  ]'}  The transferor confirms they have fulfilled their duty to apply the waste hierarchy as required by regulation 12 of the Waste (England and Wales) Regulations 2011.`);
    decl.push(`${note.declarations.description_accurate ? '[X]' : '[  ]'}  The transferor confirms this description of the waste is accurate, and that each load is recorded against this note.`);
    decl.forEach((d) => flow.para(d, { size: 9 }));
  }

  // Signatures
  if (note.signoff) {
    flow.heading(household ? 'Signatures' : '6  Signatures', { keep: 110 });
    signatures(doc, flow, note.signoff);
    for (const a of note.addenda || []) {
      flow.para(`Addition signed ${fmtTime(a.signed_at)} for: ${a.streams.map((s) => `${s.code} ${s.description}`).join('; ')}`, { size: 8.5, bold: true });
      signatures(doc, flow, a);
    }
  }

  // Load schedule
  flow.heading(household ? 'What was taken' : '7  Load schedule');
  for (const l of note.transfer.loads) {
    flow.ensure(60);
    const dest = [l.destination?.name, l.destination?.postcode].filter(Boolean).join(', ');
    flow.para(`Load ${l.ref} · Vehicle ${l.vehicle_reg || '?'}${l.vehicle_label ? ` (${l.vehicle_label})` : ''} · Left site ${fmtTime(l.closed_at)}`, { size: 9, bold: true, gap: 1 });
    flow.para(`Going to: ${dest || 'not recorded'}${l.destination?.permit_number ? ` · permit ${l.destination.permit_number}` : ''}`, { size: 8.5, gap: 5 });
    flow.table(
      [{ title: 'Item', width: 0.44 }, { title: 'Code', width: 0.14 }, { title: 'Quantity', width: 0.12, align: 'right' }, { title: 'Est. kg', width: 0.14, align: 'right' }, { title: 'cu ft', width: 0.16, align: 'right' }],
      l.lines.map((x) => [x.label, x.code, x.count_unit && x.count_unit !== 'each' ? `${x.count} ${x.count_unit}` : String(x.count), fmtKg(x.kg_est), x.cu_ft == null ? '' : String(x.cu_ft)]),
      { size: 8 },
    );
    const c = Object.values(l.containers || {}).map((v) => v.label || v).join(', ');
    if (c) flow.para(`Contained: ${c}`, { size: 8, gap: 2 });
    if (l.client_signature) {
      flow.ensure(50);
      const img = doc.addJpeg(l.client_signature.data, l.client_signature.w, l.client_signature.h);
      doc.drawImage(img, flow.m, flow.y, 120, 120 * (l.client_signature.h / l.client_signature.w));
      doc.text(flow.m + 130, flow.y + 14, `Signed for this load by ${l.client_signature.name || ''} at ${fmtTime(l.client_signature.at)}`, { size: 8 });
      flow.y += 120 * (l.client_signature.h / l.client_signature.w) + 6;
    }
    flow.space(4);
  }

  // Annex
  const { reuse, hazards_left } = note.annex || {};
  if (reuse?.length || hazards_left?.length) {
    flow.heading(household ? 'Not taken as waste' : '8  Not on this note');
    if (reuse?.length) {
      flow.para('Items leaving for reuse or donation (not waste):', { size: 9, bold: true });
      flow.para(reuse.map((r) => `${r.count} x ${r.label} (load ${r.load})`).join('; '), { size: 8.5 });
    }
    if (hazards_left?.length) {
      flow.para('Hazardous items left on site for specialist collection (not carried):', { size: 9, bold: true });
      flow.para(hazards_left.map((h) => `${h.count || 1} x ${h.type}${h.where ? ` at ${h.where}` : ''}${h.tagged ? ' (tagged)' : ''}`).join('; '), { size: 8.5 });
    }
  }

  // Footers on every page
  const law = note.regime === 'SC'
    ? 'Electronic transfer note: Environmental Protection (Duty of Care) (Scotland) Regulations 2014. Keep for at least 2 years.'
    : 'Electronic transfer note under regulation 35(4) and (5) of the Waste (England and Wales) Regulations 2011. Keep for at least 2 years.';
  const total = doc.pages.length;
  doc.pages.forEach((page, i) => {
    doc.page = page;
    doc.line(40, A4.h - 52, A4.w - 40, A4.h - 52, { width: 0.4, color: [0.75, 0.75, 0.75] });
    doc.text(40, A4.h - 40, household ? 'Receipt for household waste collected by a registered carrier.' : law, { size: 7, color: [0.4, 0.4, 0.4] });
    doc.text(40, A4.h - 30, `Sealed record fingerprint (SHA-256): ${note.seal?.fingerprint || ''}`, { size: 6.5, color: [0.4, 0.4, 0.4] });
    const p = `Page ${i + 1} of ${total}`;
    doc.text(A4.w - 40 - textWidth(p, 7), A4.h - 40, p, { size: 7, color: [0.4, 0.4, 0.4] });
  });
  return doc.output();
}

function signatures(doc, flow, s) {
  const boxW = (flow.width - 12) / 2;
  const boxH = 92;
  flow.ensure(boxH + 12);
  const y = flow.y;
  const box = (x, label, sig, name, role, at, gps) => {
    doc.rect(x, y, boxW, boxH, { stroke: [0.75, 0.75, 0.75], width: 0.5 });
    doc.text(x + 6, y + 12, label, { size: 7.5, bold: true, color: [0.4, 0.4, 0.4] });
    if (sig?.data) {
      const img = doc.addJpeg(sig.data, sig.w, sig.h);
      const h = 44, w = Math.min(boxW - 12, h * (sig.w / sig.h));
      doc.drawImage(img, x + 6, y + 16, w, h);
    }
    doc.text(x + 6, y + 70, [name, role].filter(Boolean).join(', '), { size: 8.5, bold: true });
    doc.text(x + 6, y + 82, `${fmtTime(at)}${gps ? ` · ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : ''}`, { size: 7.5, color: [0.35, 0.35, 0.35] });
  };
  box(flow.m, 'TRANSFEROR (CLIENT)', s.client_signature, s.client_name, s.client_role, s.signed_at, s.gps);
  box(flow.m + boxW + 12, 'TRANSFEREE (OUR CREW LEAD)', s.crew_signature, s.crew_name, 'for the carrier', s.signed_at, null);
  flow.y = y + boxH + 6;
  if (s.seal?.fingerprint) flow.para(`Signed description sealed on the phone at signing: ${shortPrint(s.seal.fingerprint)}`, { size: 7.5, color: [0.4, 0.4, 0.4] });
}
