import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { isPreviewDevEnvironment } from "@/lib/dev-preview";

interface BonusData {
  id: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  reputationScore: number | null;
  reputationMultiplier: number;
}

export function useBonuses() {
  const { profile, isAuthenticated } = useTelegramAuthContext();
  const [bonusData, setBonusData] = useState<BonusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBonuses = useCallback(async () => {
    if (!isAuthenticated || !profile?.id) {
      setBonusData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from("user_bonuses")
        .select("*")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data) {
        // Fetch customer reputation score
        const { data: ratings } = await supabase
          .from("app_ratings")
          .select("rating")
          .eq("rating_type", "customer")
          .eq("rated_profile_id", profile.id);
        
        let reputationScore: number | null = null;
        let reputationMultiplier = 1.0;
        if (ratings && ratings.length > 0) {
          reputationScore = Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10;
          if (reputationScore >= 4.5) reputationMultiplier = 1.2;
          else if (reputationScore < 3.0) reputationMultiplier = 0.8;
        }

        setBonusData({
          id: data.id,
          balance: data.balance || 0,
          totalEarned: data.total_earned || 0,
          totalSpent: data.total_spent || 0,
          reputationScore,
          reputationMultiplier,
        });
      } else {
        // Create initial bonus record if doesn't exist
        const { data: newData, error: insertError } = await supabase
          .from("user_bonuses")
          .insert({ profile_id: profile.id, balance: 0 })
          .select()
          .single();

        if (insertError) throw insertError;

        setBonusData({
          id: newData.id,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          reputationScore: null,
          reputationMultiplier: 1.0,
        });
      }
    } catch (err: any) {
      if (isPreviewDevEnvironment()) {
        // Preview/demo fallback: tables are locked down for direct client access.
        setBonusData({
          id: "preview-bonus",
          balance: 1250,
          totalEarned: 4380,
          totalSpent: 3130,
          reputationScore: 4.7,
          reputationMultiplier: 1.2,
        });
        setError(null);
      } else {
        console.error("Error fetching bonuses:", err);
        setError(err.message);
      }
    } finally {

      setIsLoading(false);
    }
  }, [isAuthenticated, profile?.id]);

  const spendBonuses = async (amount: number): Promise<boolean> => {
    if (!bonusData || amount <= 0 || amount > bonusData.balance) {
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from("user_bonuses")
        .update({
          balance: bonusData.balance - amount,
          total_spent: bonusData.totalSpent + amount,
        })
        .eq("id", bonusData.id);

      if (updateError) throw updateError;

      setBonusData(prev => prev ? {
        ...prev,
        balance: prev.balance - amount,
        totalSpent: prev.totalSpent + amount,
      } : null);

      return true;
    } catch (err: any) {
      if (isPreviewDevEnvironment()) {
        setBonusData(prev => prev ? {
          ...prev,
          balance: prev.balance - amount,
          totalSpent: prev.totalSpent + amount,
        } : null);
        return true;
      }
      console.error("Error spending bonuses:", err);
      return false;
    }

  };

  const addBonuses = async (amount: number): Promise<boolean> => {
    if (!bonusData || amount <= 0) {
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from("user_bonuses")
        .update({
          balance: bonusData.balance + amount,
          total_earned: bonusData.totalEarned + amount,
        })
        .eq("id", bonusData.id);

      if (updateError) throw updateError;

      setBonusData(prev => prev ? {
        ...prev,
        balance: prev.balance + amount,
        totalEarned: prev.totalEarned + amount,
      } : null);

      return true;
    } catch (err: any) {
      if (isPreviewDevEnvironment()) {
        setBonusData(prev => prev ? {
          ...prev,
          balance: prev.balance + amount,
          totalEarned: prev.totalEarned + amount,
        } : null);
        return true;
      }
      console.error("Error adding bonuses:", err);
      return false;
    }

  };

  useEffect(() => {
    fetchBonuses();
  }, [fetchBonuses]);

  return {
    balance: bonusData?.balance || 0,
    totalEarned: bonusData?.totalEarned || 0,
    totalSpent: bonusData?.totalSpent || 0,
    reputationScore: bonusData?.reputationScore ?? null,
    reputationMultiplier: bonusData?.reputationMultiplier ?? 1.0,
    isLoading,
    error,
    spendBonuses,
    addBonuses,
    refetch: fetchBonuses,
  };
}
