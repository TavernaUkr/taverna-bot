import { useState, useEffect } from "react";
import { Brain, Loader2, FileText, TrendingUp, TrendingDown, Minus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AIReport {
  id: string;
  order_id: string | null;
  supplier_id: string | null;
  report_type: string;
  ai_summary: string | null;
  sentiment_score: number | null;
  created_at: string;
}

export function AIOrderReports() {
  const [reports, setReports] = useState<AIReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("ai_order_reports" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setReports((data || []) as any as AIReport[]);
    } catch (err) {
      console.error("Error fetching reports:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const generateReport = async (orderId: string) => {
    if (!orderId.trim()) { toast.error("Введіть ID замовлення"); return; }
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-order-audit", {
        body: { order_id: orderId.trim() },
      });

      if (error) throw error;
      toast.success("Звіт згенеровано");
      fetchReports();
      setSelectedOrderId("");
    } catch (err) {
      console.error("Error generating report:", err);
      toast.error("Помилка генерації звіту");
    } finally {
      setIsGenerating(false);
    }
  };

  const getSentimentIcon = (score: number | null) => {
    if (score === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
    if (score >= 0.6) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
    if (score <= 0.3) return <TrendingDown className="h-4 w-4 text-destructive" />;
    return <Minus className="h-4 w-4 text-warning" />;
  };

  const getSentimentLabel = (score: number | null) => {
    if (score === null) return "Невизначено";
    if (score >= 0.8) return "Дуже позитивний";
    if (score >= 0.6) return "Позитивний";
    if (score >= 0.4) return "Нейтральний";
    if (score >= 0.2) return "Негативний";
    return "Дуже негативний";
  };

  const filtered = reports.filter(r =>
    !searchQuery || r.order_id?.includes(searchQuery) || r.ai_summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Звіти замовлень
        </h3>
        <Button variant="ghost" size="sm" onClick={fetchReports}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Generate new report */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium text-foreground mb-2">Згенерувати звіт</p>
          <div className="flex gap-2">
            <Input
              value={selectedOrderId}
              onChange={e => setSelectedOrderId(e.target.value)}
              placeholder="ID замовлення..."
              className="flex-1"
            />
            <Button onClick={() => generateReport(selectedOrderId)} disabled={isGenerating} size="sm">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Пошук звітів..."
          className="pl-10"
        />
      </div>

      {/* Reports list */}
      <ScrollArea className="h-[calc(100vh-500px)]">
        <div className="space-y-3 pr-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Звітів поки немає</p>
            </div>
          ) : (
            filtered.map(report => (
              <Card key={report.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getSentimentIcon(report.sentiment_score)}
                      <Badge variant="outline" className="text-xs">
                        {getSentimentLabel(report.sentiment_score)}
                        {report.sentiment_score !== null && ` (${Math.round(report.sentiment_score * 100)}%)`}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(report.created_at).toLocaleDateString("uk-UA")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Замовлення: {report.order_id?.slice(0, 8)}...
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-6">
                    {report.ai_summary || "Звіт генерується..."}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
