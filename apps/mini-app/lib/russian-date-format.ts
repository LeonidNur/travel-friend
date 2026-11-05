const RUSSIAN_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

export function formatRussianDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return RUSSIAN_DATE_FORMATTER.format(date);
}

export function formatRussianDateRange(dateFrom: string | null, dateTo: string | null): string | null {
  const from = formatRussianDate(dateFrom);
  const to = formatRussianDate(dateTo);

  if (from !== null && to !== null) {
    return `${from} — ${to}`;
  }

  return from ?? to;
}
