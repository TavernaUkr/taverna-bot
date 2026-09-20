/**
 * Базовий словник HEX-кольорів. Використовується для fallback-кружечка
 * кольору (напр. на сторінці товару), коли у товару немає жодного ФОТО
 * для прев'ю (лише відео/гіфка або взагалі нічого) — замість нейтрального
 * сірого кола показуємо реальний колір товару.
 */
export const COLOR_HEX_MAP: Record<string, string> = {
  "чорний": "#000000",
  "black": "#000000",
  "білий": "#ffffff",
  "white": "#ffffff",
  "олива": "#4B5320",
  "olive": "#4B5320",
  "хакі": "#c3b091",
  "khaki": "#c3b091",
  "сірий": "#808080",
  "gray": "#808080",
  "grey": "#808080",
  "зелений": "#228b22",
  "green": "#228b22",
  "синій": "#0000cd",
  "blue": "#0000cd",
  "коричневий": "#8b4513",
  "brown": "#8b4513",
  "бежевий": "#f5f5dc",
  "beige": "#f5f5dc",
  "червоний": "#dc143c",
  "red": "#dc143c",
  "мультикам": "#8A795D",
  "multicam": "#8A795D",
  "камуфляж": "#4b5320",
  "camo": "#4b5320",
  "песочний": "#c2b280",
  "sand": "#c2b280",
  "койот": "#81613e",
  "coyote": "#81613e",
};

/** Нейтральний сірий (tailwind neutral-200) — коли колір товару невідомий. */
const DEFAULT_FALLBACK_HEX = "#e5e7eb";

export const getColorHex = (colorName?: string | null): string => {
  const normalized = (colorName || "").toLowerCase().trim();
  return COLOR_HEX_MAP[normalized] || DEFAULT_FALLBACK_HEX;
};

/**
 * Текст (напр. перша літера кольору) має лишатись читабельним на
 * будь-якому фоні — рахуємо яскравість фону (формула YIQ) і обираємо
 * темний або світлий колір тексту.
 */
export const getReadableTextColor = (hex: string): string => {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#1f1f1f" : "#ffffff";
};
