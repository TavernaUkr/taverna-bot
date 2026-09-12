import { useState } from "react";
import {
  Sparkles,
  Eye,
  Smartphone,
  Monitor,
  RotateCcw,
  Copy,
  Check,
  MessageCircle,
  Heart,
  Share2,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
}

interface AIPostPreviewProps {
  product: Product | null;
  postText: string;
  platform: "telegram" | "instagram" | "facebook" | "tiktok" | "olx" | "prom";
  className?: string;
}

export function AIPostPreview({
  product,
  postText,
  platform,
  className,
}: AIPostPreviewProps) {
  const [viewMode, setViewMode] = useState<"mobile" | "desktop">("mobile");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(postText);
    setCopied(true);
    toast.success("Текст скопійовано!");
    setTimeout(() => setCopied(false), 2000);
  };

  const getPlatformStyles = () => {
    switch (platform) {
      case "telegram":
        return {
          bg: "bg-[#0088cc]/10",
          accent: "text-[#0088cc]",
          name: "Telegram",
          icon: "📱",
        };
      case "instagram":
        return {
          bg: "bg-gradient-to-r from-[#833ab4]/10 via-[#fd1d1d]/10 to-[#fcb045]/10",
          accent: "text-[#E1306C]",
          name: "Instagram",
          icon: "📸",
        };
      case "facebook":
        return {
          bg: "bg-[#1877F2]/10",
          accent: "text-[#1877F2]",
          name: "Facebook",
          icon: "👥",
        };
      case "tiktok":
        return {
          bg: "bg-black/10",
          accent: "text-foreground",
          name: "TikTok",
          icon: "🎵",
        };
      case "olx":
        return {
          bg: "bg-[#002F34]/10",
          accent: "text-[#23E5DB]",
          name: "OLX",
          icon: "🛒",
        };
      case "prom":
        return {
          bg: "bg-[#EB5757]/10",
          accent: "text-[#EB5757]",
          name: "Prom.ua",
          icon: "🏪",
        };
      default:
        return {
          bg: "bg-muted",
          accent: "text-primary",
          name: platform,
          icon: "📱",
        };
    }
  };

  const styles = getPlatformStyles();

  if (!product || !postText) {
    return (
      <Card className={cn("border-dashed", className)}>
        <CardContent className="p-6 text-center">
          <Eye className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Оберіть товар та згенеруйте текст для попереднього перегляду
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="py-3 px-4 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Як AI бачить цей пост
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("mobile")}
            >
              <Smartphone
                className={cn(
                  "h-4 w-4",
                  viewMode === "mobile" ? "text-primary" : "text-muted-foreground"
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("desktop")}
            >
              <Monitor
                className={cn(
                  "h-4 w-4",
                  viewMode === "desktop" ? "text-primary" : "text-muted-foreground"
                )}
              />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy}>
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {/* Platform Badge */}
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className={styles.bg}>
            {styles.icon} {styles.name}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {viewMode === "mobile" ? "Мобільний" : "Десктоп"}
          </Badge>
        </div>

        {/* Preview Frame */}
        <div
          className={cn(
            "rounded-xl border border-border overflow-hidden transition-all",
            viewMode === "mobile" ? "max-w-[320px] mx-auto" : "w-full"
          )}
        >
          {/* Post Header */}
          <div className="flex items-center gap-3 p-3 border-b border-border bg-card">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-lg">{styles.icon}</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Taverna Drop Shop</p>
              <p className="text-xs text-muted-foreground">Спонсоровано</p>
            </div>
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Post Image */}
          {product.images?.[0] && (
            <div className="aspect-square relative bg-muted">
              <img
                src={product.images[0]}
                alt={product.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 right-3">
                <Badge className="bg-background/90 text-foreground">
                  {product.price} ₴
                </Badge>
              </div>
            </div>
          )}

          {/* Post Actions */}
          {(platform === "instagram" || platform === "facebook") && (
            <div className="flex items-center justify-between p-3 border-b border-border">
              <div className="flex items-center gap-4">
                <Heart className="h-6 w-6" />
                <MessageCircle className="h-6 w-6" />
                <Share2 className="h-6 w-6" />
              </div>
              <Bookmark className="h-6 w-6" />
            </div>
          )}

          {/* Post Text */}
          <div className="p-3 bg-card">
            <p className="text-sm whitespace-pre-wrap">{postText}</p>
            
            {/* CTA Button */}
            {platform === "telegram" && (
              <Button className="w-full mt-3" size="sm">
                🛒 Замовити в Taverna
              </Button>
            )}
          </div>
        </div>

        {/* AI Insights */}
        <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            AI-оцінка ефективності
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-success">87%</p>
              <p className="text-xs text-muted-foreground">Залученість</p>
            </div>
            <div>
              <p className="text-lg font-bold text-primary">92%</p>
              <p className="text-xs text-muted-foreground">Релевантність</p>
            </div>
            <div>
              <p className="text-lg font-bold text-warning">78%</p>
              <p className="text-xs text-muted-foreground">Конверсія</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
