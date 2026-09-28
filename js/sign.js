// Finger signature pad on a canvas. Exports a JPEG on a white background.
export class SignaturePad {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = 0;
    this.onChange = onChange;
    this.resize();
    this.drawing = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.last = pos(e);
      this.ctx.beginPath();
      this.ctx.arc(this.last.x, this.last.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fill();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      const p = pos(e);
      this.ctx.beginPath();
      this.ctx.moveTo(this.last.x, this.last.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this.last = p;
    });
    const end = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.strokes++;
      this.onChange?.(this);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  resize() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 140;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    this.clear();
  }

  clear() {
    const c = this.ctx;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.strokeStyle = '#141a33';
    c.fillStyle = '#141a33';
    c.lineWidth = Math.max(2.5, this.canvas.width / 180);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    this.strokes = 0;
    this.onChange?.(this);
  }

  get isEmpty() { return this.strokes === 0; }

  toJpeg(quality = 0.7, maxWidth = 600) {
    const scale = Math.min(1, maxWidth / this.canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.round(this.canvas.width * scale);
    out.height = Math.round(this.canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0, out.width, out.height);
    return { data: out.toDataURL('image/jpeg', quality), w: out.width, h: out.height };
  }
}

// Read a camera/file image, shrink it, return a JPEG data URL.
export function readPhoto(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ data: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height, taken_at: new Date().toISOString() });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo')); };
    img.src = url;
  });
}

// Best-effort location: GPS works without mobile data; give up after a few seconds.
export function getLocation(timeout = 7000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 120000 },
    );
  });
}
