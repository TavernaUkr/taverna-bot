import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";

export type TicketType = "tech_support" | "supplier_question";
export type TicketStatus = "open" | "closed";

export interface SupportTicket {
  id: string;
  user_id: string;
  type: TicketType;
  status: TicketStatus;
  related_order_id?: string;
  created_at: string;
  updated_at: string;
}

export function useSupportTickets() {
  const { profile } = useTelegramAuthContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findOpenTicket = useCallback(
    async (type: TicketType): Promise<SupportTicket | null> => {
      if (!profile?.id) return null;

      const { data, error: fetchError } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", profile.id)
        .eq("type", type)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error("Error finding ticket:", fetchError);
        return null;
      }

      return data as SupportTicket | null;
    },
    [profile?.id]
  );

  const createTicket = useCallback(
    async (type: TicketType, relatedOrderId?: string): Promise<SupportTicket | null> => {
      if (!profile?.id) {
        setError("Авторизуйтесь для створення звернення");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const { data, error: insertError } = await supabase
          .from("support_tickets")
          .insert({
            user_id: profile.id,
            type,
            status: "open",
            related_order_id: relatedOrderId,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        return data as SupportTicket;
      } catch (err: any) {
        console.error("Error creating ticket:", err);
        setError(err.message || "Помилка створення звернення");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [profile?.id]
  );

  const getOrCreateTicket = useCallback(
    async (type: TicketType, relatedOrderId?: string): Promise<SupportTicket | null> => {
      // First, try to find an existing open ticket
      const existingTicket = await findOpenTicket(type);
      if (existingTicket) return existingTicket;

      // If not found, create a new one
      return createTicket(type, relatedOrderId);
    },
    [findOpenTicket, createTicket]
  );

  const closeTicket = useCallback(async (ticketId: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from("support_tickets")
        .update({ status: "closed" })
        .eq("id", ticketId);

      if (updateError) throw updateError;

      return true;
    } catch (err: any) {
      console.error("Error closing ticket:", err);
      setError(err.message || "Помилка закриття звернення");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getUserTickets = useCallback(async (): Promise<SupportTicket[]> => {
    if (!profile?.id) return [];

    const { data, error: fetchError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Error fetching tickets:", fetchError);
      return [];
    }

    return (data as SupportTicket[]) || [];
  }, [profile?.id]);

  return {
    isLoading,
    error,
    findOpenTicket,
    createTicket,
    getOrCreateTicket,
    closeTicket,
    getUserTickets,
  };
}
