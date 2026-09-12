import { useState } from "react";
import { Brain, TrendingUp, AlertTriangle, BarChart3, Sparkles, RefreshCw, Loader2, Activity, Users, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";

interface Insight {
  id: string;
  type: "trend" | "risk" | "opportunity";
  title: string;
  description: string;
  confidence: number;
  category?: string;
}

interface SalesTrend {
  category: string;
  growth: number;
  color: string;
}

export function AIInsightsDashboard() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([
    {
      id: "1",
      type: "trend",
      title: "Зростання попиту на тактичне взуття",
      description: "За останній тиждень попит на тактичне взуття зріс на 35%. Рекомендуємо збільшити закупівлі.",
      confidence: 87,
      category: "Взуття",
    },
    {
      id: "2",
      type: "risk",
      title: "Підозріла активність постачальника",
      description: "Постачальник 'TechSupplies' має незвично високу кількість відмін замовлень (23%).",
      confidence: 72,
    },
    {
      id: "3",
      type: "opportunity",
      title: "Потенціал для крос-селінгу",
      description: "78% покупців рюкзаків також цікавляться тактичними аксесуарами.",
      confidence: 91,
      category: "Рюкзаки",
    },
    {
      id: "4",
      type: "trend",
      title: "Сезонний тренд: зимовий одяг",
      description: "Прогнозується зростання попиту на зимовий тактичний одяг на 45% протягом наступного місяця.",
      confidence: 83,
      category: "Одяг",
    },
  ]);

  const salesTrends: SalesTrend[] = [
    { category: "Тактичне взуття", growth: 87, color: "bg-primary" },
    { category: "Рюкзаки", growth: 72, color: "bg-blue-500" },
    { category: "Одяг", growth: 65, color: "bg-emerald-500" },
    { category: "Аксесуари", growth: 58, color: "bg-amber-500" },
    { category: "Спорядження", growth: 45, color: "bg-purple-500" },
  ];

  const handleRefreshInsights = async () => {
    hapticSelection();
    setIsAnalyzing(true);
    // Simulate AI analysis
    await new Promise((resolve) => setTimeout(resolve, 2000));
    toast.success("Аналіз оновлено");
    setIsAnalyzing(false);
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case "trend":
        return <TrendingUp className="h-5 w-5 text-primary" />;
      case "risk":
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case "opportunity":
        return <Sparkles className="h-5 w-5 text-warning" />;
      default:
        return <BarChart3 className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getInsightBadge = (type: string) => {
    switch (type) {
      case "trend":
        return <Badge variant="default">Тренд</Badge>;
      case "risk":
        return <Badge variant="destructive">Ризик</Badge>;
      case "opportunity":
        return <Badge className="bg-warning text-warning-foreground">Можливість</Badge>;
      default:
        return <Badge variant="secondary">Інше</Badge>;
    }
  };

  const trendInsights = insights.filter((i) => i.type === "trend");
  const riskInsights = insights.filter((i) => i.type === "risk");
  const opportunityInsights = insights.filter((i) => i.type === "opportunity");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">AI Insights</h3>
            <p className="text-xs text-muted-foreground">Powered by Gemini</p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRefreshInsights}
          disabled={isAnalyzing}
          className="active:scale-95"
        >
          {isAnalyzing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Summary Stats with Gradients */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-6 w-6 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{trendInsights.length}</p>
            <p className="text-xs text-muted-foreground">Трендів</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{riskInsights.length}</p>
            <p className="text-xs text-muted-foreground">Ризиків</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20">
          <CardContent className="p-4 text-center">
            <Sparkles className="h-6 w-6 text-warning mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{opportunityInsights.length}</p>
            <p className="text-xs text-muted-foreground">Можливостей</p>
          </CardContent>
        </Card>
      </div>

      {/* Sales Trends Bar Chart */}
      <Card className="bg-gradient-to-br from-muted/30 to-muted/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Тренди продажів по категоріям
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {salesTrends.map((trend, index) => (
            <div key={trend.category} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground font-medium">{trend.category}</span>
                <span className="text-muted-foreground">+{trend.growth}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all duration-500", trend.color)}
                  style={{ 
                    width: `${trend.growth}%`,
                    animationDelay: `${index * 100}ms`
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Platform Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">2,847</p>
                <p className="text-xs text-muted-foreground">Активних клієнтів</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Package className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">12,459</p>
                <p className="text-xs text-muted-foreground">Товарів в каталозі</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights List */}
      <div className="space-y-3">
        <h4 className="font-medium text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Детальний аналіз
        </h4>
        {isAnalyzing ? (
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
              <p className="font-medium text-foreground">Аналізуємо дані...</p>
              <p className="text-sm text-muted-foreground">
                Gemini AI обробляє інформацію про продажі та постачальників
              </p>
            </CardContent>
          </Card>
        ) : (
          insights.map((insight) => (
            <Card 
              key={insight.id} 
              className={cn(
                "hover:shadow-md transition-shadow cursor-pointer",
                insight.type === "risk" && "border-destructive/30 bg-destructive/5",
                insight.type === "opportunity" && "border-warning/30 bg-warning/5",
                insight.type === "trend" && "border-primary/30 bg-primary/5"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    insight.type === "risk" && "bg-destructive/20",
                    insight.type === "opportunity" && "bg-warning/20",
                    insight.type === "trend" && "bg-primary/20"
                  )}>
                    {getInsightIcon(insight.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {getInsightBadge(insight.type)}
                      {insight.category && (
                        <Badge variant="outline" className="text-xs">
                          {insight.category}
                        </Badge>
                      )}
                    </div>
                    <h4 className="font-medium text-foreground">{insight.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {insight.description}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-xs text-muted-foreground">
                        Впевненість:
                      </span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full",
                            insight.confidence > 80 ? "bg-success" : insight.confidence > 60 ? "bg-warning" : "bg-destructive"
                          )}
                          style={{ width: `${insight.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium">{insight.confidence}%</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Placeholder for future features */}
      <Card className="bg-gradient-to-br from-purple-500/5 to-blue-500/5 border-dashed border-purple-500/20">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Brain className="h-8 w-8 text-purple-500" />
          </div>
          <h4 className="font-medium text-foreground mb-2">Розширена аналітика</h4>
          <p className="text-sm text-muted-foreground">
            Детальні звіти про продажі, прогнозування попиту та автоматичні рекомендації 
            будуть доступні після повної інтеграції з Gemini AI.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
