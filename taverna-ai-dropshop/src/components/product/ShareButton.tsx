import { useState } from "react";
import { Share2, Copy, Check, Send } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface ShareButtonProps {
  productId: string;
  productName: string;
}

export const ShareButton = ({ productId, productName }: ShareButtonProps) => {
  const [copied, setCopied] = useState(false);

  const shareLink = `${typeof window !== "undefined" ? window.location.origin : ""}/product/${productId}`;
  const shareText = `${productName} — в Taverna Drop Shop`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      toast.success("Посилання скопійовано");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Не вдалося скопіювати");
    }
  };

  const handleShareTelegram = () => {
    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}`;
    window.open(telegramUrl, "_blank");
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: productName,
          text: shareText,
          url: shareLink,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("Помилка при поділенні");
        }
      }
    } else {
      handleCopyLink();
    }
  };

  // Check if we're in Telegram WebApp
  const isTelegram = typeof window !== "undefined" && (window as any).Telegram?.WebApp;

  if (isTelegram) {
    // Use Telegram's native share in Mini App
    const handleTelegramShare = () => {
      const tg = (window as any).Telegram.WebApp;
      if (tg.sendData) {
        // Can use sendData for internal sharing
        tg.sendData(JSON.stringify({
          action: "share_product",
          product_id: productId,
          link: shareLink,
        }));
      }
      // Fallback to opening share URL
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(shareLink)}`);
    };

    return (
      <button
        type="button"
        onClick={handleTelegramShare}
        className="p-2 bg-gray-100 rounded-full shrink-0"
        aria-label="Поділитися"
      >
        <Share2 className="w-5 h-5 text-gray-500" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-2 bg-gray-100 rounded-full shrink-0"
          aria-label="Поділитися"
        >
          <Share2 className="w-5 h-5 text-gray-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleShareTelegram}>
          <Send className="h-4 w-4 mr-2" />
          Telegram
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink}>
          {copied ? (
            <Check className="h-4 w-4 mr-2 text-primary" />
          ) : (
            <Copy className="h-4 w-4 mr-2" />
          )}
          {copied ? "Скопійовано!" : "Копіювати посилання"}
        </DropdownMenuItem>
        {navigator.share && (
          <DropdownMenuItem onClick={handleNativeShare}>
            <Share2 className="h-4 w-4 mr-2" />
            Більше опцій...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
