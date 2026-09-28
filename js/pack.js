// Job packs and setup packs travel as links: JSON, deflated, base64url, in the
// URL fragment (#pack=... / #setup=...). The fragment is never sent to the web
// server, so job details go phone-to-phone only.

const VERSION = '1';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodePack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  return `${VERSION}.${toBase64Url(packed)}`;
}

export async function decodePack(text) {
  const [version, data] = String(text).trim().split('.');
  if (version !== VERSION || !data) throw new Error('This link is not a job or setup pack this app can read.');
  const raw = await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(raw));
}

// Pull a pack out of a full link, a bare fragment, or pasted text.
export function extractPack(text) {
  const m = String(text).match(/#(pack|setup)=([0-9]+\.[A-Za-z0-9_-]+)/);
  if (m) return { kind: m[1], data: m[2] };
  const bare = String(text).trim().match(/^([0-9]+\.[A-Za-z0-9_-]+)$/);
  return bare ? { kind: null, data: bare[1] } : null;
}
