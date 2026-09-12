
CREATE TABLE public.user_auto_queues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Авто-черга',
  type text NOT NULL CHECK (type IN ('posting', 'advertising')),
  mode text NOT NULL CHECK (mode IN ('random', 'manual')),
  supplier_ids uuid[] NOT NULL DEFAULT '{}',
  product_ids uuid[] NOT NULL DEFAULT '{}',
  interval_minutes int NOT NULL DEFAULT 60 CHECK (interval_minutes >= 5),
  platforms text[] NOT NULL DEFAULT '{telegram}',
  budget numeric DEFAULT 0,
  active_hours_start int CHECK (active_hours_start IS NULL OR (active_hours_start BETWEEN 0 AND 23)),
  active_hours_end int CHECK (active_hours_end IS NULL OR (active_hours_end BETWEEN 0 AND 23)),
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  is_paused boolean NOT NULL DEFAULT false,
  total_published int NOT NULL DEFAULT 0,
  current_position int NOT NULL DEFAULT 0,
  last_executed_at timestamp with time zone,
  next_execution_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_auto_queues_profile ON public.user_auto_queues(profile_id);
CREATE INDEX idx_user_auto_queues_next_exec ON public.user_auto_queues(next_execution_at) WHERE is_paused = false;

ALTER TABLE public.user_auto_queues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auto queues service role access"
ON public.user_auto_queues
FOR ALL
USING (true);

CREATE POLICY "Users can view own auto queues"
ON public.user_auto_queues
FOR SELECT
USING (true);

CREATE POLICY "Admins and moderators can view all auto queues"
ON public.user_auto_queues
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'moderator'::app_role)
);

CREATE TRIGGER update_user_auto_queues_updated_at
BEFORE UPDATE ON public.user_auto_queues
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
