-- Create profiles table for Telegram users
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  telegram_username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  user_type TEXT DEFAULT 'customer' CHECK (user_type IN ('customer', 'supplier')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create delivery_addresses table
CREATE TABLE public.delivery_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT false,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_service TEXT NOT NULL CHECK (delivery_service IN ('nova_poshta', 'ukrposhta', 'meest')),
  city TEXT NOT NULL,
  city_ref TEXT,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('warehouse', 'postomat', 'address')),
  warehouse_number TEXT,
  warehouse_ref TEXT,
  street_address TEXT,
  building_number TEXT,
  apartment TEXT,
  postal_code TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT UNIQUE,
  profile_id UUID REFERENCES public.profiles(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned')),
  delivery_address_id UUID REFERENCES public.delivery_addresses(id),
  delivery_service TEXT,
  delivery_tracking TEXT,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_cost DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('cash_on_delivery', 'card', 'privat24')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create order_items table
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  product_image TEXT,
  size TEXT,
  color TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create cart_items table
CREATE TABLE public.cart_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  size TEXT,
  color TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(profile_id, product_id, size, color)
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for profiles (public access for MVP, will restrict later)
CREATE POLICY "Profiles viewable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Profiles insertable" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Profiles updatable" ON public.profiles FOR UPDATE USING (true);

-- RLS policies for delivery_addresses
CREATE POLICY "Addresses viewable" ON public.delivery_addresses FOR SELECT USING (true);
CREATE POLICY "Addresses insertable" ON public.delivery_addresses FOR INSERT WITH CHECK (true);
CREATE POLICY "Addresses updatable" ON public.delivery_addresses FOR UPDATE USING (true);
CREATE POLICY "Addresses deletable" ON public.delivery_addresses FOR DELETE USING (true);

-- RLS policies for orders
CREATE POLICY "Orders viewable" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Orders insertable" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Orders updatable" ON public.orders FOR UPDATE USING (true);

-- RLS policies for order_items
CREATE POLICY "Order items viewable" ON public.order_items FOR SELECT USING (true);
CREATE POLICY "Order items insertable" ON public.order_items FOR INSERT WITH CHECK (true);

-- RLS policies for cart_items
CREATE POLICY "Cart viewable" ON public.cart_items FOR SELECT USING (true);
CREATE POLICY "Cart insertable" ON public.cart_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Cart updatable" ON public.cart_items FOR UPDATE USING (true);
CREATE POLICY "Cart deletable" ON public.cart_items FOR DELETE USING (true);

-- Indexes for performance
CREATE INDEX idx_profiles_telegram ON public.profiles(telegram_id);
CREATE INDEX idx_delivery_addresses_profile ON public.delivery_addresses(profile_id);
CREATE INDEX idx_orders_profile ON public.orders(profile_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_cart_items_profile ON public.cart_items(profile_id);

-- Timestamp triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_delivery_addresses_updated_at
  BEFORE UPDATE ON public.delivery_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cart_items_updated_at
  BEFORE UPDATE ON public.cart_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Generate order number function
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'TG-' || TO_CHAR(now(), 'YYYYMMDD') || '-' || LPAD(nextval('order_number_seq')::text, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION public.generate_order_number();