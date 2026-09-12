import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { toast } from "sonner";

export type RewardType = 
  | "review_text" 
  | "review_photo" 
  | "store_rating" 
  | "manager_rating" 
  | "tech_support_rating";

const REWARD_AMOUNTS: Record<RewardType, number> = {
  review_text: 10,
  review_photo: 15,
  store_rating: 5,
  manager_rating: 5,
  tech_support_rating: 5,
};

const REWARD_LABELS: Record<RewardType, string> = {
  review_text: "відгук про замовлення",
  review_photo: "відгук з фото",
  store_rating: "оцінку магазину",
  manager_rating: "оцінку менеджера",
  tech_support_rating: "оцінку тех. підтримки",
};

export function useRatingRewards() {
  const { profile, isAuthenticated } = useTelegramAuthContext();
  const [isAwarding, setIsAwarding] = useState(false);

  const checkAlreadyRewarded = useCallback(async (orderId: string, rewardType: RewardType): Promise<boolean> => {
    if (!profile?.id) return true;
    
    const { data } = await supabase
      .from("rating_rewards" as any)
      .select("id")
      .eq("profile_id", profile.id)
      .eq("order_id", orderId)
      .eq("reward_type", rewardType)
      .maybeSingle();
    
    return !!data;
  }, [profile?.id]);

  const awardBonus = useCallback(async (
    orderId: string, 
    rewardType: RewardType
  ): Promise<number> => {
    if (!isAuthenticated || !profile?.id) return 0;

    try {
      const alreadyRewarded = await checkAlreadyRewarded(orderId, rewardType);
      if (alreadyRewarded) return 0;

      const amount = REWARD_AMOUNTS[rewardType];

      // Insert reward record (unique constraint prevents duplicates)
      const { error: rewardError } = await supabase
        .from("rating_rewards" as any)
        .insert({
          profile_id: profile.id,
          order_id: orderId,
          reward_type: rewardType,
          amount,
        });

      if (rewardError) {
        // Duplicate constraint violation = already rewarded
        if (rewardError.code === "23505") return 0;
        throw rewardError;
      }

      // Update bonus balance
      const { data: bonusData } = await supabase
        .from("user_bonuses")
        .select("id, balance, total_earned")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (bonusData) {
        await supabase
          .from("user_bonuses")
          .update({
            balance: (bonusData.balance || 0) + amount,
            total_earned: (bonusData.total_earned || 0) + amount,
          })
          .eq("id", bonusData.id);
      } else {
        await supabase
          .from("user_bonuses")
          .insert({
            profile_id: profile.id,
            balance: amount,
            total_earned: amount,
          });
      }

      return amount;
    } catch (err) {
      console.error("Error awarding bonus:", err);
      return 0;
    }
  }, [isAuthenticated, profile?.id, checkAlreadyRewarded]);

  const awardForOrderReview = useCallback(async (
    orderId: string, 
    hasPhoto: boolean = false
  ): Promise<number> => {
    setIsAwarding(true);
    let totalAwarded = 0;

    try {
      // Award for text review
      const textReward = await awardBonus(orderId, "review_text");
      totalAwarded += textReward;

      // Award extra for photo
      if (hasPhoto) {
        const photoReward = await awardBonus(orderId, "review_photo");
        totalAwarded += photoReward;
      }

      if (totalAwarded > 0) {
        toast.success(`🎉 Ви отримали +${totalAwarded}₴ бонусів за ${REWARD_LABELS[hasPhoto ? "review_photo" : "review_text"]}!`);
      }
    } finally {
      setIsAwarding(false);
    }

    return totalAwarded;
  }, [awardBonus]);

  const awardForRating = useCallback(async (
    orderId: string,
    rewardType: RewardType
  ): Promise<number> => {
    setIsAwarding(true);
    try {
      const amount = await awardBonus(orderId, rewardType);
      if (amount > 0) {
        toast.success(`🎉 +${amount}₴ бонусів за ${REWARD_LABELS[rewardType]}!`);
      }
      return amount;
    } finally {
      setIsAwarding(false);
    }
  }, [awardBonus]);

  const getOrderRewards = useCallback(async (orderId: string): Promise<RewardType[]> => {
    if (!profile?.id) return [];
    
    const { data } = await supabase
      .from("rating_rewards" as any)
      .select("reward_type")
      .eq("profile_id", profile.id)
      .eq("order_id", orderId);

    return (data || []).map((r: any) => r.reward_type as RewardType);
  }, [profile?.id]);

  return {
    awardForOrderReview,
    awardForRating,
    getOrderRewards,
    checkAlreadyRewarded,
    isAwarding,
    REWARD_AMOUNTS,
  };
}
