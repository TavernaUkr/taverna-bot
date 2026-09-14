/** Сира підкатегорія з бекенду (AI-назва + кількість товарів). */
export interface RawSubcategory {
  name: string;
  count: number;
}

/** Зведена група для кнопок каталогу. */
export interface SmartSubcategoryGroup {
  id: string;
  name: string;
  icon: SmartGroupIcon;
  count: number;
  originals: string[];
}

export type SmartGroupIcon =
  | "all"
  | "jacket"
  | "sweater"
  | "pants"
  | "headwear"
  | "bag"
  | "shoes"
  | "other";

interface GroupRule {
  id: string;
  name: string;
  icon: SmartGroupIcon;
  keywords: string[];
}

/**
 * Порядок важливий: спочатку вужчі речі (балаклава), потім куртки/кофти.
 * «Флісові балаклави» має потрапити в головні убори, а не в кофти.
 */
const GROUP_RULES: GroupRule[] = [
  {
    id: "headwear",
    name: "Балаклави",
    icon: "headwear",
    keywords: ["балаклав", "баф", "шапк", "панам", "кепк", "берет", "капюшон"],
  },
  {
    id: "jackets",
    name: "Куртки",
    icon: "jacket",
    keywords: ["куртк", "бушлат", "парк", "вітровк", "ветровк", "анорак", "пуховик"],
  },
  {
    id: "sweaters",
    name: "Кофти",
    icon: "sweater",
    keywords: ["кофт", "світшот", "свитшот", "худі", "худи", "толстов"],
  },
  {
    id: "pants",
    name: "Штани",
    icon: "pants",
    keywords: ["штан", "брюк"],
  },
  {
    id: "bags",
    name: "Сумки та рюкзаки",
    icon: "bag",
    keywords: ["сумк", "рюкзак", "підсумок", "подсумок"],
  },
  {
    id: "shoes",
    name: "Взуття",
    icon: "shoes",
    keywords: ["взутт", "кросівк", "кроссов", "берц", "черевик", "сандал"],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Знаходить правило групи для сирої AI-назви. */
export function matchSmartGroup(rawName: string): GroupRule | null {
  const haystack = normalize(rawName);
  if (!haystack) return null;
  return GROUP_RULES.find((rule) => rule.keywords.some((word) => haystack.includes(word))) || null;
}

/**
 * Згортає сирі підкатегорії в короткі кнопки.
 * Назви, що не підпали під правила, лишаються окремими кнопками як є.
 */
export function groupSubcategories(items: RawSubcategory[]): SmartSubcategoryGroup[] {
  const grouped = new Map<string, SmartSubcategoryGroup>();
  const unmatched: SmartSubcategoryGroup[] = [];

  for (const item of items) {
    const name = item.name?.trim();
    if (!name) continue;
    const count = Number(item.count) || 0;
    const rule = matchSmartGroup(name);

    if (!rule) {
      const existing = unmatched.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.count += count;
        if (!existing.originals.some((orig) => orig.toLowerCase() === name.toLowerCase())) {
          existing.originals.push(name);
        }
      } else {
        unmatched.push({
          id: `raw:${name.toLowerCase()}`,
          name,
          icon: "other",
          count,
          originals: [name],
        });
      }
      continue;
    }

    const current = grouped.get(rule.id);
    if (current) {
      current.count += count;
      if (!current.originals.some((orig) => orig.toLowerCase() === name.toLowerCase())) {
        current.originals.push(name);
      }
    } else {
      grouped.set(rule.id, {
        id: rule.id,
        name: rule.name,
        icon: rule.icon,
        count,
        originals: [name],
      });
    }
  }

  const ordered = GROUP_RULES
    .map((rule) => grouped.get(rule.id))
    .filter((group): group is SmartSubcategoryGroup => Boolean(group));

  unmatched.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return [...ordered, ...unmatched];
}

/** CSV з URL (`Куртки A,Куртки B`) → список оригінальних назв. */
export function parseSubCategoryParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return uniqueNames(value.split(","));
}

export function readSubCategoryParams(searchParams: URLSearchParams): string[] {
  return uniqueNames(searchParams.getAll("sub_category").flatMap((item) => parseSubCategoryParam(item)));
}

export function encodeSubCategoryParam(names: string[]): string {
  return uniqueNames(names).join(",");
}

export function isGroupSelected(group: SmartSubcategoryGroup, selected: string[]): boolean {
  if (group.originals.length === 0) return false;
  const selectedKeys = new Set(selected.map(normalize));
  return group.originals.every((name) => selectedKeys.has(normalize(name)));
}

/** Для чіпів: показуємо коротку назву групи, а не сирі AI-рядки. */
export function displayNameForSubcategories(originals: string[]): string {
  const groups = groupSubcategories(originals.map((name) => ({ name, count: 1 })));
  if (groups.length === 1) return groups[0].name;
  return originals[0] || "";
}
