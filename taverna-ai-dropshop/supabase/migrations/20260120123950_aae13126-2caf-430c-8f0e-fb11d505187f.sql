-- Create supplier_applications table for admin moderation
CREATE TABLE public.supplier_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id),
  telegram_id BIGINT,
  
  -- Application type
  supplier_type TEXT NOT NULL CHECK (supplier_type IN ('individual', 'company')),
  
  -- Contact info
  full_name TEXT NOT NULL,
  company_name TEXT,
  tax_id TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  telegram_username TEXT,
  
  -- Shop info
  shop_name TEXT NOT NULL,
  xml_url TEXT,
  telegram_channel TEXT,
  description TEXT,
  
  -- AI analysis results
  ai_analysis JSONB DEFAULT '{}'::jsonb,
  similar_suppliers JSONB DEFAULT '[]'::jsonb,
  plagiarism_score NUMERIC DEFAULT 0,
  reseller_probability NUMERIC DEFAULT 0,
  suggested_categories TEXT[] DEFAULT '{}',
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supplier_applications ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Supplier applications viewable by admins"
ON public.supplier_applications
FOR SELECT
USING (true);

CREATE POLICY "Supplier applications service role access"
ON public.supplier_applications
FOR ALL
USING (true);

-- Add markup_percentage to suppliers table
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS markup_percentage NUMERIC DEFAULT 33;

-- Add ai_description column to products for AI-rewritten descriptions
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS ai_description TEXT,
ADD COLUMN IF NOT EXISTS original_description TEXT;

-- Create trigger for updated_at
CREATE TRIGGER update_supplier_applications_updated_at
BEFORE UPDATE ON public.supplier_applications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();