import { useState, useEffect } from "react";
import { Headphones, MessageSquare, Loader2, Clock, AlertCircle, CheckCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TechTicket {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  user_name: string;
  telegram_username: string | null;
  last_message: string | null;
  unread_count: number;
}

const agoISO = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

const MOCK_TICKETS: TechTicket[] = [
  {
    id: "demo-t1",
    user_id: "demo-u1",
    status: "open",
    created_at: agoISO(29),
    updated_at: agoISO(0.2),
    user_name: "Олег Кравченко",
    telegram_username: "oleg_k",
    last_message: "Оплата пройшла, але замовлення досі не з'явилось у списку. Що робити?",
    unread_count: 6,
  },
  {
    id: "demo-t2",
    user_id: "demo-u2",
    status: "open",
    created_at: agoISO(7),
    updated_at: agoISO(1.5),
    user_name: "Ірина Мельник",
    telegram_username: "iryna_m",
    last_message: "Не можу привʼязати картку для повернень — пише помилку.",
    unread_count: 3,
  },
  {
    id: "demo-t3",
    user_id: "demo-u3",
    status: "open",
    created_at: agoISO(3),
    updated_at: agoISO(0.6),
    user_name: "Nord Supply (магазин)",
    telegram_username: "nord_supply",
    last_message: "Баланс магазину не оновився після виплати за вчорашні замовлення.",
    unread_count: 2,
  },
  {
    id: "demo-t4",
    user_id: "demo-u4",
    status: "open",
    created_at: agoISO(0.4),
    updated_at: agoISO(0.1),
    user_name: "Марта Гнатюк",
    telegram_username: null,
    last_message: "Як використати бонуси при оформленні замовлення?",
    unread_count: 1,
  },
];

export function TechSupportQueue() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TechTicket[]>(MOCK_TICKETS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchTickets();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("tech-support-tickets")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_tickets",
          filter: "type=eq.tech_support",
        },
        () => {
          fetchTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchTickets = async () => {
    try {
      // Fetch tech support tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("type", "tech_support")
        .eq("status", "open")
        .order("updated_at", { ascending: false });

      if (ticketsError) throw ticketsError;

      // Fetch profiles for users
      const userIds = (ticketsData || []).map(t => t.user_id);
      const { data: profiles } = await supabase
        .from("profiles_safe" as any)
        .select("id, first_name, last_name")
        .in("id", userIds);

      // Fetch last messages
      const ticketIds = (ticketsData || []).map(t => t.id);
      const { data: messages } = await supabase
        .from("ticket_messages")
        .select("ticket_id, message_text, created_at, sender_role")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: false });

      // Group messages by ticket
      const messagesByTicket: Record<string, { last: string | null; unread: number }> = {};
      (messages || []).forEach(m => {
        if (!messagesByTicket[m.ticket_id]) {
          messagesByTicket[m.ticket_id] = { last: m.message_text, unread: 0 };
        }
        if (m.sender_role === "user") {
          messagesByTicket[m.ticket_id].unread++;
        }
      });

      // Combine data
      const ticketsWithData: TechTicket[] = (ticketsData || []).map(t => {
        const profile = ((profiles || []) as any[]).find((p: any) => p.id === t.user_id);
        const messageData = messagesByTicket[t.id] || { last: null, unread: 0 };

        return {
          ...t,
          user_name: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Користувач",
          telegram_username: null,
          last_message: messageData.last,
          unread_count: messageData.unread,
        };
      });

      if (ticketsWithData.length > 0) setTickets(ticketsWithData);
    } catch (err) {
      console.error("Error fetching tickets:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChat = (ticketId: string) => {
    navigate(`/support/chat/${ticketId}`);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Щойно";
    if (diffMins < 60) return `${diffMins} хв тому`;
    if (diffHours < 24) return `${diffHours} год тому`;
    return `${diffDays} дн тому`;
  };

  const getUrgencyLevel = (createdAt: string, unreadCount: number) => {
    const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
    if (hours > 24 || unreadCount > 5) return "high";
    if (hours > 4 || unreadCount > 2) return "medium";
    return "low";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Headphones className="h-5 w-5 text-blue-500" />
          Черга тех. підтримки
        </h3>
        <Badge variant={tickets.length > 0 ? "default" : "outline"}>
          {tickets.length} звернень
        </Badge>
      </div>

      <ScrollArea className="h-[350px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="font-medium text-foreground">Всі питання вирішено!</p>
              <p className="text-sm text-muted-foreground">
                Немає активних звернень до тех. підтримки
              </p>
            </div>
          ) : (
            tickets.map((ticket) => {
              const urgency = getUrgencyLevel(ticket.created_at, ticket.unread_count);

              return (
                <Card
                  key={ticket.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    urgency === "high" ? "border-destructive/50" :
                    urgency === "medium" ? "border-warning/50" : ""
                  }`}
                  onClick={() => handleOpenChat(ticket.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {urgency === "high" && (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="font-medium text-foreground">
                          {ticket.user_name}
                        </span>
                        {ticket.telegram_username && (
                          <span className="text-xs text-muted-foreground">
                            @{ticket.telegram_username}
                          </span>
                        )}
                      </div>
                      {ticket.unread_count > 0 && (
                        <Badge variant="destructive" className="h-5 min-w-5 flex items-center justify-center">
                          {ticket.unread_count}
                        </Badge>
                      )}
                    </div>

                    {ticket.last_message && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {ticket.last_message}
                      </p>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(ticket.updated_at)}
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          urgency === "high" ? "bg-destructive/10 text-destructive" :
                          urgency === "medium" ? "bg-warning/10 text-warning" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {urgency === "high" ? "Терміново" : urgency === "medium" ? "Очікує" : "Нове"}
                        </span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Відкрити міст
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </div>

                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
