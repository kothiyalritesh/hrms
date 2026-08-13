const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a calendar date without converting India-local midnight through UTC. */
export function parseIndiaCalendarDate(input: string): string | null {
  const value = input.trim();
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);

  const numeric = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (numeric) {
    // Manual biometric exports in this application use DD/MM/YYYY.
    return validDate(+numeric[3], +numeric[2], +numeric[1]);
  }

  const named = value.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 3)];
    return month ? validDate(+named[3], month, +named[1]) : null;
  }
  return null;
}

