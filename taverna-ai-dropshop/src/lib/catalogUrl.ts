/** Єдиний шлях каталогу MiniApp. Старий /search лишається аліасом. */
export const CATALOG_PATH = "/catalog";

export function readCharFilters(params: URLSearchParams): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  params.forEach((raw, key) => {
    if (!key.startsWith("char_")) return;
    const name = key.slice(5).trim();
    if (!name) return;
    const bucket = result[name] || (result[name] = []);
    for (const part of String(raw).split(",")) {
      const value = part.trim();
      if (value && !bucket.includes(value)) bucket.push(value);
    }
  });
  return result;
}

export function setCharFiltersOnParams(
  params: URLSearchParams,
  chars: Record<string, string[]>
): void {
  for (const key of Array.from(params.keys())) {
    if (key.startsWith("char_")) params.delete(key);
  }
  Object.entries(chars).forEach(([name, values]) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    for (const value of values) {
      const trimmed = String(value || "").trim();
      if (trimmed) params.append(`char_${trimmedName}`, trimmed);
    }
  });
}

export function charFiltersKey(chars: Record<string, string[]>): string {
  return Object.entries(chars)
    .filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, "uk"))
    .map(([name, values]) => `${name}=${[...values].sort().join(",")}`)
    .join("&");
}

export function toggleCharValue(
  current: Record<string, string[]>,
  name: string,
  value: string
): Record<string, string[]> {
  const next = { ...current };
  const list = next[name] || [];
  const exists = list.includes(value);
  const updated = exists ? list.filter((item) => item !== value) : [...list, value];
  if (updated.length === 0) {
    delete next[name];
  } else {
    next[name] = updated;
  }
  return next;
}
