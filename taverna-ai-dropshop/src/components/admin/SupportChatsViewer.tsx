import { useState, useEffect } from "react";
import { MessageSquare, Eye, User, Store, Loader2, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Ticket {
  id: string;
  user_id: string;
  type: string;
  status: string;
  related_order_id: string | null;
  created_at: string;
  updated_at: string;
  profile?: {
    first_name: string | null;
    last_name: string | null;
  };
  messages_count?: number;
}

interface Message {
  id: string;
  ticket_id: string;
  sender_role: string;
  message_text: string;
  created_at: string;
}

export function SupportChatsViewer() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setIsLoading(true);
    try {
      // Fetch tickets
      const { data: ticketsData, error: ticketsError } = await supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100);

      if (ticketsError) throw ticketsError;

      // Fetch profiles
      const userIds = (ticketsData || []).map(t => t.user_id);
      const { data: profiles } = await supabase
        .from("profiles_safe" as any)
        .select("id, first_name, last_name")
        .in("id", userIds);

      // Fetch message counts
      const { data: messageCounts } = await supabase
        .from("ticket_messages")
        .select("ticket_id");

      // Count messages per ticket
      const countMap: Record<string, number> = {};
      (messageCounts || []).forEach(m => {
        countMap[m.ticket_id] = (countMap[m.ticket_id] || 0) + 1;
      });

      // Merge data
      const ticketsWithData = (ticketsData || []).map(ticket => ({
        ...ticket,
        profile: ((profiles || []) as any[]).find((p: any) => p.id === ticket.user_id),
        messages_count: countMap[ticket.id] || 0,
      }));

      setTickets(ticketsWithData as Ticket[]);
    } catch (err) {
      console.error("Error fetching tickets:", err);
      toast.error("Помилка завантаження чатів");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMessages = async (ticketId: string) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error("Error fetching messages:", err);
      toast.error("Помилка завантаження повідомлень");
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleViewChat = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    fetchMessages(ticket.id);
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "tech_support":
        return { label: "Тех. підтримка", icon: MessageSquare, color: "bg-blue-500" };
      case "supplier_question":
        return { label: "Питання до постачальника", icon: Store, color: "bg-amber-500" };
      default:
        return { label: type, icon: MessageSquare, color: "bg-muted" };
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("uk-UA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Перегляд чатів підтримки
        </h3>
        <Badge variant="outline">{tickets.length} чатів</Badge>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-3 pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Немає чатів підтримки</p>
            </div>
          ) : (
            tickets.map((ticket) => {
              const typeInfo = getTypeLabel(ticket.type);
              const TypeIcon = typeInfo.icon;
              
              return (
                <Card 
                  key={ticket.id} 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleViewChat(ticket)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${typeInfo.color}/20 flex items-center justify-center`}>
                          <TypeIcon className={`h-5 w-5 text-${typeInfo.color.replace('bg-', '')}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">
                              {ticket.profile?.first_name || "Користувач"} {ticket.profile?.last_name || ""}
                            </p>
                            <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
                              {ticket.status === "open" ? "Відкритий" : "Закритий"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {typeInfo.label} • {ticket.messages_count || 0} повідомлень
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(ticket.updated_at)}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Chat Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Чат з {selectedTicket?.profile?.first_name || "користувачем"}
              <Badge variant={selectedTicket?.status === "open" ? "default" : "secondary"}>
                {selectedTicket?.status === "open" ? "Відкритий" : "Закритий"}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="h-[400px] pr-4">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Немає повідомлень
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender_role === "user" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-lg ${
                        msg.sender_role === "user"
                          ? "bg-muted"
                          : msg.sender_role === "moderator"
                          ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                          : "bg-primary/20 text-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {msg.sender_role === "user" ? "Користувач" : 
                           msg.sender_role === "moderator" ? "Модератор" :
                           msg.sender_role === "supplier" ? "Постачальник" : "Бот"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(msg.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{msg.message_text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
