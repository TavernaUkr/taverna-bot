-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'supplier', 'customer');

-- Create secure user_roles table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role app_role NOT NULL DEFAULT 'customer',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to get user's primary role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role 
      WHEN 'admin' THEN 1 
      WHEN 'moderator' THEN 2 
      WHEN 'supplier' THEN 3 
      ELSE 4 
    END
  LIMIT 1
$$;

-- RLS Policies for user_roles table
CREATE POLICY "Users can view own roles" 
ON public.user_roles 
FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage roles" 
ON public.user_roles 
FOR ALL 
USING (true);

-- Migrate existing user_type data to user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT id, 
  CASE 
    WHEN user_type = 'admin' THEN 'admin'::app_role
    WHEN user_type = 'supplier' THEN 'supplier'::app_role
    ELSE 'customer'::app_role
  END
FROM public.profiles
WHERE user_type IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;