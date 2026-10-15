// Date-only handling. Spreadsheet execution dates have no time or timezone, so
// they are carried as "YYYY-MM-DD" strings and stored in a DATE column. They
// must never pass through local-time conversion, which shifts them by a day
// for users east/west of UTC.

export type DateOrder = "DMY" | "MDY";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Excel serial date (1900 system) to YYYY-MM-DD. */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  // 25569 = days between 1899-12-30 (Excel epoch incl. the 1900 leap bug) and 1970-01-01.
  const ms = Math.round((Math.floor(serial) - 25569) * 86400000);
  const dt = new Date(ms);
  return valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Normalise a spreadsheet date cell to YYYY-MM-DD.
 * - Date objects from ExcelJS represent the cell's wall-clock value in UTC,
 *   so UTC components are used (never local time).
 * - Numbers are treated as Excel serials.
 * - Strings accept ISO (YYYY-MM-DD, optionally with a time part) or
 *   D/M/YYYY vs M/D/YYYY according to `order`.
 * Returns undefined for blank input and null for unparseable input.
 */
export function toIsoDate(value: unknown, order: DateOrder = "DMY"): string | null | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return valid(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") return excelSerialToIsoDate(value);
  const s = String(value).trim();
  if (s === "") return undefined;
  const isoWithTime = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoWithTime) return valid(+isoWithTime[1], +isoWithTime[2], +isoWithTime[3]);
  const parts = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (parts) {
    let y = +parts[3];
    if (parts[3].length === 2) y += 2000;
    const a = +parts[1];
    const b = +parts[2];
    return order === "DMY" ? valid(y, b, a) : valid(y, a, b);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIsoDate(Number(s));
  return null;
}

/** Convert YYYY-MM-DD to a Date at UTC midnight for a Prisma @db.Date column. */
export function isoDateToDbDate(iso: string): Date {
  const m = iso.match(ISO_DATE);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** Format a @db.Date value (UTC midnight) back to YYYY-MM-DD without shifting. */
export function dbDateToIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Human display for a date-only value, e.g. "12 Oct 2026". Timezone-safe. */
export function formatDateOnly(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const iso = typeof d === "string" ? d : dbDateToIso(d);
  if (!iso) return "—";
  const [y, m, day] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[m - 1]} ${y}`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Today's date in the server's local calendar as YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date();
  return valid(now.getFullYear(), now.getMonth() + 1, now.getDate())!;
}
