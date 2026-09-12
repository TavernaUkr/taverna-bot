import { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2, Package, HelpCircle, Sparkles, MapPin, Paperclip, Camera, Image as ImageIcon, RotateCcw, User, Store, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { useNavigate } from "react-router-dom";
import { hapticImpact } from "@/lib/haptics";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  image?: string;
  actions?: Array<{
    type: "order" | "supplier" | "product" | "support";
    label: string;
    data: string;
  }>;
}

export interface OrderContext {
  order_id: string;
  order_number: string;
  topic: "exchange" | "return" | "complaint" | "manager" | "general";
}

const topicLabels: Record<string, string> = {
  exchange: "Обмін товару",
  return: "Повернення товару",
  complaint: "Скарга на замовлення",
  manager: "Зв'язок з менеджером",
  general: "Загальне питання",
};

const quickActions = [
  { icon: Package, label: "Де моє замовлення?", prompt: "Де моє замовлення? Покажи мої останні замовлення" },
  { icon: HelpCircle, label: "Допоможи обрати розмір", prompt: "Допоможи обрати правильний розмір" },
  { icon: Store, label: "Знайти постачальника", prompt: "Допоможи знайти постачальника тактичного спорядження" },
  { icon: RotateCcw, label: "Повернення товару", prompt: "Хочу повернути або обміняти товар. Як це зробити?" },
  { icon: Search, label: "Знайти товар", prompt: "Допоможи знайти потрібний товар" },
];

// Global event for opening with order context
let openWithContextCallback: ((ctx: OrderContext) => void) | null = null;

export function openAIChatWithContext(ctx: OrderContext) {
  if (openWithContextCallback) {
    openWithContextCallback(ctx);
  }
}

export const AIChatAssistant = () => {
  const navigate = useNavigate();
  const { sessionToken, profile } = useTelegramAuthContext();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Вітаю! 👋 Я ваш AI-асистент Taverna. Чим можу допомогти?\n\n📦 Перевірити замовлення\n🔍 Знайти товар або постачальника\n📐 Підібрати розмір\n↩️ Допомогти з поверненням\n📸 Надішліть фото — я розпізнаю товар!",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [orderContext, setOrderContext] = useState<OrderContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Register global callback for opening with context
  useEffect(() => {
    openWithContextCallback = (ctx: OrderContext) => {
      setOrderContext(ctx);
      setIsOpen(true);
      
      // Add context message
      const contextMsg: Message = {
        id: `ctx-${Date.now()}`,
        role: "assistant",
        content: `📋 Замовлення: **${ctx.order_number}**\n📌 Тема: ${topicLabels[ctx.topic] || ctx.topic}\n\nОпишіть вашу ситуацію, і я допоможу вирішити питання. Якщо потрібен менеджер — я з'єдную вас анонімно.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, contextMsg]);

      // Auto-send context to AI
      const autoMsg = `Замовлення ${ctx.order_number}, тема: ${topicLabels[ctx.topic]}. Клієнт хоче ${topicLabels[ctx.topic].toLowerCase()}.`;
      setTimeout(() => handleSend(autoMsg), 500);
    };
    return () => { openWithContextCallback = null; };
  }, [messages, sessionToken]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);
  
  useEffect(() => {
    if (profile?.first_name && messages.length === 1) {
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: `Вітаю, ${profile.first_name}! 👋 Я ваш AI-асистент Taverna.\n\n📦 Перевірити ваші замовлення\n🔍 Знайти товар або постачальника\n📐 Підібрати розмір\n↩️ Допомогти з поверненням\n📸 Надішліть фото — я розпізнаю товар!`,
        timestamp: new Date(),
      }]);
    }
  }, [profile?.first_name]);

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    hapticImpact("light");
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) { toast.error('Файл занадто великий (макс. 10MB)'); return; }
      const reader = new FileReader();
      reader.onloadend = () => { setSelectedImage(reader.result as string); setSelectedFileName("Фото з камери"); toast.success('Фото готове до відправки'); };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { toast.error('Файл занадто великий (макс. 5MB)'); return; }
      const reader = new FileReader();
      reader.onloadend = () => { setSelectedImage(reader.result as string); setSelectedFileName(file.name); toast.success('Фото додано'); };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const clearSelectedImage = () => { setSelectedImage(null); setSelectedFileName(null); };

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText && !selectedImage) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText || (selectedImage ? "📷 Фото для аналізу" : ""),
      timestamp: new Date(),
      image: selectedImage || undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    const imageToSend = selectedImage;
    clearSelectedImage();
    setIsTyping(true);

    try {
      const context = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      let imageBase64: string | undefined;
      if (imageToSend) {
        const base64Match = imageToSend.match(/^data:image\/\w+;base64,(.+)$/);
        if (base64Match) imageBase64 = base64Match[1];
      }

      // Add order context if present
      let enrichedMessage = messageText;
      if (orderContext && !messageText.includes(orderContext.order_number)) {
        enrichedMessage = `[Контекст: замовлення ${orderContext.order_number}, тема: ${topicLabels[orderContext.topic]}] ${messageText}`;
      }

      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { message: enrichedMessage, session_token: sessionToken, context, image_base64: imageBase64 },
      });

      if (error) throw error;

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data?.message || "Вибачте, виникла помилка. Спробуйте ще раз.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('AI Assistant error:', error);
      const fallbackMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Вибачте, AI-асистент тимчасово недоступний. Спробуйте пізніше або зверніться до підтримки.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); handleSend(); };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-24 right-4 z-40",
          "w-14 h-14 rounded-full",
          "bg-gradient-to-br from-primary to-accent",
          "text-primary-foreground shadow-lg",
          "flex items-center justify-center",
          "hover:scale-110 active:scale-95",
          "transition-all duration-200",
          "animate-pulse-slow",
          isOpen && "hidden"
        )}
      >
        <Bot className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-live rounded-full animate-pulse" />
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className={cn(
          "fixed inset-x-4 bottom-24 z-50",
          "max-w-md mx-auto",
          "bg-card border border-border rounded-2xl",
          "shadow-2xl overflow-hidden",
          "animate-scale-in",
          "flex flex-col",
          "h-[70vh] max-h-[500px]"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary to-accent text-primary-foreground">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">Taverna AI</h3>
                <p className="text-xs opacity-80">
                  {orderContext ? `${orderContext.order_number} • ${topicLabels[orderContext.topic]}` : "Завжди онлайн"}
                </p>
              </div>
            </div>
            <button
              onClick={() => { setIsOpen(false); setOrderContext(null); }}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3",
                  message.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                )}>
                  {message.image && <img src={message.image} alt="Завантажене фото" className="max-w-full rounded-lg mb-2 max-h-40 object-cover" />}
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <p className={cn("text-[10px] mt-1", message.role === "user" ? "opacity-70" : "text-muted-foreground")}>
                    {message.timestamp.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length <= 2 && !orderContext && (
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <button key={action.label} onClick={() => handleSend(action.prompt)} className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5",
                    "bg-muted hover:bg-muted/80 rounded-full",
                    "text-xs text-foreground",
                    "transition-colors"
                  )}>
                    <action.icon className="h-3 w-3" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected Image Preview */}
          {selectedImage && (
            <div className="px-4 pb-2">
              <div className="relative inline-block">
                <img src={selectedImage} alt="Preview" className="h-16 rounded-lg object-cover" />
                <button onClick={clearSelectedImage} className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
                  <X className="h-3 w-3" />
                </button>
                <p className="text-xs text-muted-foreground mt-1 truncate max-w-[100px]">{selectedFileName}</p>
              </div>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 border-t border-border">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { hapticImpact("light"); cameraInputRef.current?.click(); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20 hover:from-primary/30 hover:to-accent/30 text-primary hover:text-accent-foreground transition-all"
                disabled={isTyping} title="Зробити фото">
                <Camera className="h-5 w-5" />
              </button>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleCameraCapture} className="hidden" />
              <button type="button" onClick={() => { hapticImpact("light"); fileInputRef.current?.click(); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                disabled={isTyping} title="Додати файл">
                <Paperclip className="h-5 w-5" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
              <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={selectedImage ? "Опишіть фото..." : orderContext ? "Опишіть проблему..." : "Напишіть повідомлення..."}
                className={cn("flex-1 h-11 px-4 rounded-xl", "bg-muted border border-border", "text-foreground placeholder:text-muted-foreground", "focus:outline-none focus:ring-2 focus:ring-primary/50", "transition-all")}
                disabled={isTyping} />
              <Button type="submit" size="icon" disabled={(!input.trim() && !selectedImage) || isTyping} className="h-11 w-11 rounded-xl">
                {isTyping ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </Button>
            </div>
            <p className="text-[10px] text-center text-muted-foreground mt-2">
              📸 Сфоткайте товар для пошуку або повернення
            </p>
            <p className="text-[10px] text-center text-muted-foreground mt-1 opacity-70">
              Працює на базі Google Gemini AI • Дані захищені
            </p>
          </form>
        </div>
      )}
    </>
  );
};
