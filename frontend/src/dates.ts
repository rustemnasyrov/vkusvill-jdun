/** Понедельник той же календарной недели (локальное время), полдень чтобы избежать сдвига из‑за DST. */
export function startOfIsoWeekMonday(from: Date): Date {
  const x = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12, 0, 0, 0);
  const dow = x.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayColumnDate(weekMonday: Date, colIndex: number): Date {
  return addDays(weekMonday, colIndex);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Строка `YYYY-MM-DD` для `<input type="date">` по локальной календарной дате (не через UTC из ISO). */
export function localDateInputValue(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Смещение недели для календаря курьера: `week_monday` из `POST /admin/shifts/generate-week`
 * интерпретируем как локальный календарный понедельник (та же семантика, что у слотов по дню недели).
 */
export function weekOffsetForApiMonday(ymd: string): number {
  const parts = ymd.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return 0;
  const apiMonday = new Date(y, m - 1, d, 0, 0, 0, 0);
  const thisMonday = startOfIsoWeekMonday(new Date());
  const diffMs = apiMonday.getTime() - thisMonday.getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}
