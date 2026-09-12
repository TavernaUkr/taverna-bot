import {
  Info,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Users,
  Eye,
  Target,
  BarChart3,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface PlatformCondition {
  id: string;
  name: string;
  icon: string;
  status: "active" | "pending" | "unavailable";
  apiConnected: boolean;
  features: {
    name: string;
    available: boolean;
  }[];
  conditions: {
    minBudget: number;
    maxBudget: number;
    minDuration: string;
    maxDuration: string;
    targetingOptions: string[];
    contentRequirements: string[];
  };
  metrics: {
    avgReach: string;
    avgCTR: string;
    avgConversion: string;
  };
  moderationTime: string;
  markup: number;
}

const PLATFORM_CONDITIONS: PlatformCondition[] = [
  {
    id: "telegram",
    name: "Telegram",
    icon: "📱",
    status: "active",
    apiConnected: true,
    features: [
      { name: "Кнопки дій", available: true },
      { name: "Inline запити", available: true },
      { name: "Статистика", available: true },
      { name: "A/B тестування", available: false },
    ],
    conditions: {
      minBudget: 100,
      maxBudget: 50000,
      minDuration: "1 день",
      maxDuration: "30 днів",
      targetingOptions: ["Геолокація", "Вік", "Інтереси", "Пристрій"],
      contentRequirements: ["Текст до 4096 символів", "Фото до 10 шт", "Відео до 50 МБ"],
    },
    metrics: {
      avgReach: "10K-50K",
      avgCTR: "2.5%",
      avgConversion: "3.2%",
    },
    moderationTime: "1-2 години",
    markup: 33,
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "📸",
    status: "active",
    apiConnected: false,
    features: [
      { name: "Stories", available: true },
      { name: "Reels", available: true },
      { name: "Shopping Tags", available: false },
      { name: "Influencer колаби", available: false },
    ],
    conditions: {
      minBudget: 200,
      maxBudget: 100000,
      minDuration: "1 день",
      maxDuration: "90 днів",
      targetingOptions: ["Демографія", "Інтереси", "Поведінка", "Lookalike"],
      contentRequirements: ["Фото 1080x1080", "Відео до 60 сек", "Без забороненого контенту"],
    },
    metrics: {
      avgReach: "15K-80K",
      avgCTR: "1.8%",
      avgConversion: "2.1%",
    },
    moderationTime: "2-4 години",
    markup: 33,
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: "👥",
    status: "active",
    apiConnected: false,
    features: [
      { name: "Каруселі", available: true },
      { name: "Відео реклама", available: true },
      { name: "Ретаргетинг", available: true },
      { name: "Facebook Pixel", available: false },
    ],
    conditions: {
      minBudget: 200,
      maxBudget: 100000,
      minDuration: "1 день",
      maxDuration: "90 днів",
      targetingOptions: ["Детальний таргетинг", "Custom Audiences", "Lookalike"],
      contentRequirements: ["Текст до 125 символів", "Фото 1200x628", "Відео до 240 хв"],
    },
    metrics: {
      avgReach: "20K-100K",
      avgCTR: "1.5%",
      avgConversion: "1.8%",
    },
    moderationTime: "2-6 годин",
    markup: 33,
  },
  {
    id: "olx",
    name: "OLX",
    icon: "🛒",
    status: "active",
    apiConnected: false,
    features: [
      { name: "Топ оголошення", available: true },
      { name: "Підняття", available: true },
      { name: "VIP статус", available: true },
      { name: "Виділення кольором", available: true },
    ],
    conditions: {
      minBudget: 50,
      maxBudget: 10000,
      minDuration: "1 день",
      maxDuration: "30 днів",
      targetingOptions: ["Категорія", "Регіон", "Ціновий діапазон"],
      contentRequirements: ["Заголовок до 70 символів", "Опис до 9000 символів", "До 24 фото"],
    },
    metrics: {
      avgReach: "5K-30K",
      avgCTR: "4.2%",
      avgConversion: "5.1%",
    },
    moderationTime: "30 хв - 2 години",
    markup: 28,
  },
  {
    id: "prom",
    name: "Prom.ua",
    icon: "🏪",
    status: "active",
    apiConnected: false,
    features: [
      { name: "Топ у категорії", available: true },
      { name: "Рекомендації", available: true },
      { name: "Бейджі довіри", available: true },
      { name: "Реклама в пошуку", available: false },
    ],
    conditions: {
      minBudget: 100,
      maxBudget: 30000,
      minDuration: "1 день",
      maxDuration: "30 днів",
      targetingOptions: ["Категорія", "Регіон", "Ключові слова"],
      contentRequirements: ["Назва до 100 символів", "Опис до 4000 символів", "До 20 фото"],
    },
    metrics: {
      avgReach: "8K-40K",
      avgCTR: "3.8%",
      avgConversion: "4.2%",
    },
    moderationTime: "1-3 години",
    markup: 28,
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "🎵",
    status: "pending",
    apiConnected: false,
    features: [
      { name: "In-Feed Ads", available: true },
      { name: "Spark Ads", available: false },
      { name: "Hashtag Challenge", available: false },
      { name: "TopView", available: false },
    ],
    conditions: {
      minBudget: 300,
      maxBudget: 200000,
      minDuration: "1 день",
      maxDuration: "60 днів",
      targetingOptions: ["Вік", "Стать", "Інтереси", "Поведінка"],
      contentRequirements: ["Відео 9:16", "До 60 сек", "Музика без копірайту"],
    },
    metrics: {
      avgReach: "50K-200K",
      avgCTR: "1.2%",
      avgConversion: "1.5%",
    },
    moderationTime: "4-8 годин",
    markup: 33,
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "▶️",
    status: "pending",
    apiConnected: false,
    features: [
      { name: "Skippable Ads", available: true },
      { name: "Bumper Ads", available: true },
      { name: "Discovery Ads", available: false },
      { name: "Masthead", available: false },
    ],
    conditions: {
      minBudget: 500,
      maxBudget: 500000,
      minDuration: "1 день",
      maxDuration: "90 днів",
      targetingOptions: ["Демографія", "Інтереси", "Ключові слова", "Теми"],
      contentRequirements: ["Відео від 6 сек", "Формат MP4/MOV", "HD якість"],
    },
    metrics: {
      avgReach: "30K-150K",
      avgCTR: "0.8%",
      avgConversion: "1.2%",
    },
    moderationTime: "6-24 години",
    markup: 28,
  },
  {
    id: "google",
    name: "Google Ads",
    icon: "🔍",
    status: "pending",
    apiConnected: false,
    features: [
      { name: "Пошукова реклама", available: true },
      { name: "Display Network", available: true },
      { name: "Ремаркетинг", available: false },
      { name: "Performance Max", available: false },
    ],
    conditions: {
      minBudget: 200,
      maxBudget: 1000000,
      minDuration: "1 день",
      maxDuration: "Необмежено",
      targetingOptions: ["Ключові слова", "Аудиторії", "Локація", "Пристрої"],
      contentRequirements: ["Заголовки до 30 символів", "Описи до 90 символів", "Банери різних розмірів"],
    },
    metrics: {
      avgReach: "Необмежений",
      avgCTR: "2.0%",
      avgConversion: "3.5%",
    },
    moderationTime: "1-24 години",
    markup: 23,
  },
];

interface PlatformConditionsProps {
  selectedPlatforms: string[];
  className?: string;
}

export function PlatformConditions({
  selectedPlatforms,
  className,
}: PlatformConditionsProps) {
  if (selectedPlatforms.length === 0) {
    return null;
  }

  const selectedConditions = PLATFORM_CONDITIONS.filter((p) =>
    selectedPlatforms.includes(p.id)
  );

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Умови обраних платформ</span>
      </div>

      {selectedConditions.map((platform) => (
        <Card key={platform.id} className="overflow-hidden">
          <CardHeader className="py-3 px-4 bg-muted/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="text-lg">{platform.icon}</span>
                {platform.name}
                <Badge
                  variant={platform.status === "active" ? "default" : "secondary"}
                  className={cn(
                    "text-xs",
                    platform.status === "active"
                      ? "bg-success/20 text-success"
                      : "bg-warning/20 text-warning"
                  )}
                >
                  {platform.status === "active" ? "Активний" : "Очікується"}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {platform.apiConnected ? (
                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    API підключено
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                    <Clock className="h-3 w-3 mr-1" />
                    API очікується
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 space-y-4">
            {/* Features */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Доступні функції:</p>
              <div className="flex flex-wrap gap-1">
                {platform.features.map((feature) => (
                  <Badge
                    key={feature.name}
                    variant="outline"
                    className={cn(
                      "text-xs",
                      feature.available
                        ? "bg-success/10 text-success border-success/30"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {feature.available ? "✓" : "○"} {feature.name}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-muted/50 rounded-lg text-center">
                <Users className="h-4 w-4 mx-auto text-primary mb-1" />
                <p className="text-xs text-muted-foreground">Охоплення</p>
                <p className="text-sm font-medium">{platform.metrics.avgReach}</p>
              </div>
              <div className="p-2 bg-muted/50 rounded-lg text-center">
                <Eye className="h-4 w-4 mx-auto text-primary mb-1" />
                <p className="text-xs text-muted-foreground">CTR</p>
                <p className="text-sm font-medium">{platform.metrics.avgCTR}</p>
              </div>
              <div className="p-2 bg-muted/50 rounded-lg text-center">
                <Target className="h-4 w-4 mx-auto text-primary mb-1" />
                <p className="text-xs text-muted-foreground">Конверсія</p>
                <p className="text-sm font-medium">{platform.metrics.avgConversion}</p>
              </div>
            </div>

            {/* Conditions */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-muted/30 rounded">
                <p className="text-muted-foreground">Бюджет:</p>
                <p className="font-medium">
                  {platform.conditions.minBudget} - {platform.conditions.maxBudget} ₴
                </p>
              </div>
              <div className="p-2 bg-muted/30 rounded">
                <p className="text-muted-foreground">Тривалість:</p>
                <p className="font-medium">
                  {platform.conditions.minDuration} - {platform.conditions.maxDuration}
                </p>
              </div>
            </div>

            {/* Targeting */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Таргетинг:</p>
              <p className="text-xs">{platform.conditions.targetingOptions.join(" • ")}</p>
            </div>

            {/* Moderation & Markup */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Модерація: {platform.moderationTime}
                </span>
              </div>
              <Badge className="text-xs bg-primary/10 text-primary">
                Націнка: +{platform.markup}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
