// Tamper-evident seal: SHA-256 over a canonical JSON form of a record.
// Canonical = keys sorted, no whitespace, undefined dropped. The same record
// always gives the same fingerprint on any device, so anyone holding the
// record can re-check that nothing was changed after it was sealed.

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',') + ']';
  return '{' + Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
    .join(',') + '}';
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fingerprint everything except the `seal` field itself.
export async function fingerprint(record) {
  const { seal, ...rest } = record;
  return sha256Hex(canonical(rest));
}

export async function sealRecord(record) {
  return { ...record, seal: { alg: 'SHA-256', fingerprint: await fingerprint(record) } };
}

export async function verifySeal(record) {
  if (!record?.seal?.fingerprint) return { ok: false, reason: 'No seal on this record' };
  const actual = await fingerprint(record);
  return actual === record.seal.fingerprint
    ? { ok: true, fingerprint: actual }
    : { ok: false, reason: 'Record has changed since it was sealed', expected: record.seal.fingerprint, actual };
}

export const shortPrint = (fp) => (fp ? `${fp.slice(0, 8)} ${fp.slice(8, 16)}` : '');
