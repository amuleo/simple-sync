/**
 * Persian (Jalali) calendar utilities.
 *
 * Primary method: native Intl.DateTimeFormat with the persian calendar.
 * This is supported in all modern browsers (Chrome 76+, Safari 14+, Node 20+)
 * and is accurate for a very wide range of years — well beyond any practical use.
 *
 * Fallback: Borkowski's algorithm (valid for 1178–1633 AP / 1799–2254 AD).
 * Used only if the Intl method fails for any reason.
 */

export interface JalaliDate {
  year: number;
  month: number;
  day: number;
}

// ============================================================
// Primary: Intl.DateTimeFormat
// ============================================================

function tryIntl(date: Date): JalaliDate | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const yearStr = parts.find((p) => p.type === 'year')?.value ?? '';
    const monthStr = parts.find((p) => p.type === 'month')?.value ?? '';
    const dayStr = parts.find((p) => p.type === 'day')?.value ?? '';

    const year = parseInt(yearStr.replace(/[^\d]/g, ''), 10);
    const month = parseInt(monthStr.replace(/[^\d]/g, ''), 10);
    const day = parseInt(dayStr.replace(/[^\d]/g, ''), 10);

    if (year > 1300 && year < 1700 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  } catch {}
  return null;
}

// ============================================================
// Fallback: Borkowski's algorithm
// ============================================================

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

function jalCal(jy: number) {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm = 0;
  let jump = 0;

  if (jy < jp || jy >= breaks[bl - 1]) {
    throw new Error('Invalid Jalaali year ' + jy);
  }

  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function jdnFromJalali(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function jalaliFromJdn(jdn: number): JalaliDate {
  const g = d2g(jdn);
  let jy = g.gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(g.gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm: number;
  let jd: number;

  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { year: jy, month: jm, day: jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { year: jy, month: jm, day: jd };
}

function fallbackFromDate(date: Date): JalaliDate {
  const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return jalaliFromJdn(jdn);
}

// ============================================================
// Public API
// ============================================================

export function toJalali(date: Date = new Date()): JalaliDate {
  return tryIntl(date) ?? fallbackFromDate(date);
}

/**
 * Format as "1405.01.15" — safe for folder names, sorts alphabetically.
 */
export function formatJalaliPath(j: JalaliDate): string {
  const y = String(j.year).padStart(4, '0');
  const m = String(j.month).padStart(2, '0');
  const d = String(j.day).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * Format as "1405/01/15 14:30:22" — for human display.
 */
export function formatJalaliReadable(date: Date = new Date()): string {
  const j = toJalali(date);
  const y = String(j.year).padStart(4, '0');
  const m = String(j.month).padStart(2, '0');
  const d = String(j.day).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
}

/**
 * Timestamp suffix for unique folder names when multiple backups happen on
 * the same day. Example: "1405.01.15-143022"
 */
export function jalaliTimestampSuffix(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}
