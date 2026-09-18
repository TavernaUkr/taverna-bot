/** Парсер UTC → локальний час пристрою (Kyiv, тощо). Naive ISO без Z вважаємо UTC. */
export function parseUtcDate(dateString: string): Date {
  const raw = dateString.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`);
  }
  const normalized = raw.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

export function formatLocalTime(dateString?: string | null): string {
  if (!dateString) return "—";
  const date = parseUtcDate(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
