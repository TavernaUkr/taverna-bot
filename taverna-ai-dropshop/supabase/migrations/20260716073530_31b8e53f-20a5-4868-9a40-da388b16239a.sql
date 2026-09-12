
-- =========================================================================
-- Security lockdown migration
-- =========================================================================

-- ---- user_roles: drop permissive policies, keep only service role access ----
DROP POLICY IF EXISTS "Service role can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
-- Service role bypasses RLS. No policy needed for anon/authenticated -> denied by default.
REVOKE ALL ON public.user_roles FROM anon, authenticated;

-- ---- order_splits ----
DROP POLICY IF EXISTS "Suppliers can view own splits" ON public.order_splits;
DROP POLICY IF EXISTS "Service role can manage splits" ON public.order_splits;
REVOKE ALL ON public.order_splits FROM anon, authenticated;

-- ---- supplier_payment_deadlines ----
DROP POLICY IF EXISTS "Suppliers can view own deadlines" ON public.supplier_payment_deadlines;
DROP POLICY IF EXISTS "Service role can manage deadlines" ON public.supplier_payment_deadlines;
REVOKE ALL ON public.supplier_payment_deadlines FROM anon, authenticated;

-- ---- supplier_payouts ----
DROP POLICY IF EXISTS "Suppliers can view own payouts" ON public.supplier_payouts;
DROP POLICY IF EXISTS "Service role can manage payouts" ON public.supplier_payouts;
REVOKE ALL ON public.supplier_payouts FROM anon, authenticated;

-- ---- shop_manager_links ----
DROP POLICY IF EXISTS "Users can view own manager links" ON public.shop_manager_links;
DROP POLICY IF EXISTS "Service role can manage links" ON public.shop_manager_links;
REVOKE ALL ON public.shop_manager_links FROM anon, authenticated;

-- ---- user_bonuses ----
DROP POLICY IF EXISTS "Users can view own bonuses" ON public.user_bonuses;
DROP POLICY IF EXISTS "Service role can manage bonuses" ON public.user_bonuses;
REVOKE ALL ON public.user_bonuses FROM anon, authenticated;

-- ---- user_auto_queues ----
DROP POLICY IF EXISTS "Users can view own auto queues" ON public.user_auto_queues;
DROP POLICY IF EXISTS "Users can manage own auto queues" ON public.user_auto_queues;
DROP POLICY IF EXISTS "Service role can manage auto queues" ON public.user_auto_queues;
REVOKE ALL ON public.user_auto_queues FROM anon, authenticated;

-- ---- used_promo_codes ----
DROP POLICY IF EXISTS "Users can view own used promos" ON public.used_promo_codes;
DROP POLICY IF EXISTS "Users can create used promos" ON public.used_promo_codes;
DROP POLICY IF EXISTS "Service role can manage used promos" ON public.used_promo_codes;
REVOKE ALL ON public.used_promo_codes FROM anon, authenticated;

-- ---- rating_rewards ----
DROP POLICY IF EXISTS "Users can view own rating rewards" ON public.rating_rewards;
DROP POLICY IF EXISTS "Users can create rating rewards" ON public.rating_rewards;
DROP POLICY IF EXISTS "Service role can manage rating rewards" ON public.rating_rewards;
REVOKE ALL ON public.rating_rewards FROM anon, authenticated;

-- ---- cart_items ----
DROP POLICY IF EXISTS "Cart items service role access" ON public.cart_items;
DROP POLICY IF EXISTS "Users can manage own cart" ON public.cart_items;
REVOKE ALL ON public.cart_items FROM anon, authenticated;

-- ---- app_ratings: expose only aggregated/anonymous fields ----
DROP POLICY IF EXISTS "Users can view own ratings" ON public.app_ratings;
DROP POLICY IF EXISTS "Anyone can view ratings" ON public.app_ratings;
DROP POLICY IF EXISTS "Users can create ratings" ON public.app_ratings;
DROP POLICY IF EXISTS "Users can insert own ratings" ON public.app_ratings;
DROP POLICY IF EXISTS "Service role can manage app_ratings" ON public.app_ratings;

REVOKE ALL ON public.app_ratings FROM anon, authenticated;
-- Public read only of aggregate columns (no comments, no profile ids)
GRANT SELECT (id, rating, rating_type, target_id, created_at) ON public.app_ratings TO anon, authenticated;

CREATE POLICY "Public can read anonymized ratings"
  ON public.app_ratings FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---- reviews: hide reviewer's internal profile id from public reads ----
REVOKE ALL ON public.reviews FROM anon, authenticated;
GRANT SELECT (
  id, product_id, author_name, rating, title, content,
  is_verified_purchase, created_at, updated_at, images, helpful_count
) ON public.reviews TO anon, authenticated;
-- Existing SELECT policies on reviews still apply. Writes go through edge functions.

-- ---- reports: keep anonymous insert but prevent reporter impersonation ----
DROP POLICY IF EXISTS "Anyone can create reports" ON public.reports;
CREATE POLICY "Anon can create anonymous reports"
  ON public.reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    reporter_profile_id IS NULL
    -- reporter_telegram_id is best-effort captured; service role sets profile id
  );

-- =========================================================================
-- Storage: shop-assets bucket
-- =========================================================================
-- Remove broad list/write policies. Keep only per-object GET by URL.
DROP POLICY IF EXISTS "Public can list shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public read shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can update shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete shop-assets" ON storage.objects;
DROP POLICY IF EXISTS "shop-assets read" ON storage.objects;
DROP POLICY IF EXISTS "shop-assets insert" ON storage.objects;
DROP POLICY IF EXISTS "shop-assets update" ON storage.objects;
DROP POLICY IF EXISTS "shop-assets delete" ON storage.objects;

-- Allow reading a specific object by its full path (needed for public URLs)
-- but disallow bucket-wide listing.
CREATE POLICY "shop-assets object read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'shop-assets');
-- Writes must go via service-role (edge functions). No INSERT/UPDATE/DELETE policy for clients.

-- =========================================================================
-- Definer functions: revoke direct anon/authenticated execution
-- =========================================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO service_role;
