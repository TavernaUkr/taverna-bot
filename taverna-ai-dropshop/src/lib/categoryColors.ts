// Dynamic category color system - uses app design tokens
// Colors are consistent with the military/tactical theme

// Category gradients using semantic colors from the design system
const categoryGradients = [
  "from-primary to-primary/70",           // Olive primary
  "from-accent to-accent/70",             // Lime accent
  "from-[#4a5d23] to-[#3d4d1c]",          // Dark olive military
  "from-[#5a4a3a] to-[#4a3a2a]",          // Brown leather
  "from-[#3a4a5a] to-[#2a3a4a]",          // Steel blue tactical
  "from-[#2a3a2a] to-[#1a2a1a]",          // Dark forest
  "from-warning to-warning/70",           // Amber warning
  "from-[#4a3a3a] to-[#3a2a2a]",          // Dark burgundy
  "from-[#3a3a4a] to-[#2a2a3a]",          // Slate
  "from-[#4a5a3a] to-[#3a4a2a]",          // Khaki
  "from-[#5a4a6a] to-[#4a3a5a]",          // Muted purple
  "from-[#3a5a5a] to-[#2a4a4a]",          // Teal tactical
];

const categoryBgColors = [
  "bg-primary",
  "bg-accent",
  "bg-[#4a5d23]",
  "bg-[#5a4a3a]",
  "bg-[#3a4a5a]",
  "bg-[#2a3a2a]",
  "bg-warning",
  "bg-[#4a3a3a]",
  "bg-[#3a3a4a]",
  "bg-[#4a5a3a]",
  "bg-[#5a4a6a]",
  "bg-[#3a5a5a]",
];

// Predefined category colors by slug for consistency
const categorySlugColors: Record<string, { gradient: string; bgColor: string }> = {
  'military': { gradient: "from-[#4a5d23] to-[#3d4d1c]", bgColor: "bg-[#4a5d23]" },
  'clothing': { gradient: "from-primary to-primary/70", bgColor: "bg-primary" },
  'accessories': { gradient: "from-accent to-accent/70", bgColor: "bg-accent" },
  'footwear': { gradient: "from-[#5a4a3a] to-[#4a3a2a]", bgColor: "bg-[#5a4a3a]" },
  'bags': { gradient: "from-[#3a4a5a] to-[#2a3a4a]", bgColor: "bg-[#3a4a5a]" },
  'tactical': { gradient: "from-[#2a3a2a] to-[#1a2a1a]", bgColor: "bg-[#2a3a2a]" },
  'auto': { gradient: "from-[#3a3a4a] to-[#2a2a3a]", bgColor: "bg-[#3a3a4a]" },
  'gaming': { gradient: "from-[#5a4a6a] to-[#4a3a5a]", bgColor: "bg-[#5a4a6a]" },
  'gifts': { gradient: "from-warning to-warning/70", bgColor: "bg-warning" },
  'home': { gradient: "from-[#4a5a3a] to-[#3a4a2a]", bgColor: "bg-[#4a5a3a]" },
  'electronics': { gradient: "from-[#3a4a5a] to-[#2a3a4a]", bgColor: "bg-[#3a4a5a]" },
  'kids': { gradient: "from-[#5a4a6a] to-[#4a3a5a]", bgColor: "bg-[#5a4a6a]" },
};

/**
 * Generate a deterministic hash from a string (category ID)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a persistent gradient for a category based on its ID or slug
 * First checks for predefined slug colors, then falls back to hash-based selection
 */
export function getCategoryGradient(categoryIdOrSlug: string): string {
  // Check if it's a known slug
  const knownColor = categorySlugColors[categoryIdOrSlug.toLowerCase()];
  if (knownColor) {
    return knownColor.gradient;
  }
  
  // Fall back to hash-based selection
  const hash = hashString(categoryIdOrSlug);
  return categoryGradients[hash % categoryGradients.length];
}

/**
 * Get a persistent background color for a category based on its ID or slug
 */
export function getCategoryBgColor(categoryIdOrSlug: string): string {
  // Check if it's a known slug
  const knownColor = categorySlugColors[categoryIdOrSlug.toLowerCase()];
  if (knownColor) {
    return knownColor.bgColor;
  }
  
  // Fall back to hash-based selection
  const hash = hashString(categoryIdOrSlug);
  return categoryBgColors[hash % categoryBgColors.length];
}

/**
 * Get both gradient and bg color for a category
 */
export function getCategoryColors(categoryIdOrSlug: string): {
  gradient: string;
  bgColor: string;
} {
  // Check if it's a known slug
  const knownColor = categorySlugColors[categoryIdOrSlug.toLowerCase()];
  if (knownColor) {
    return knownColor;
  }
  
  // Fall back to hash-based selection
  const hash = hashString(categoryIdOrSlug);
  const index = hash % categoryGradients.length;
  return {
    gradient: categoryGradients[index],
    bgColor: categoryBgColors[index],
  };
}
