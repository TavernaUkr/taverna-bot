/**
 * API Services Layer
 * Abstracts all data fetching for easy migration to FastAPI
 */

import { supabase } from "@/integrations/supabase/client";

// Types for API responses
export interface Product {
  id: string;
  name: string;
  price: number;
  original_price?: number;
  images: string[];
  description?: string;
  sizes?: string[];
  colors?: string[];
  brand?: string;
  model?: string;
  in_stock: boolean;
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  attributes?: Record<string, any>;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url?: string;
  product_count?: number;
  parent_id?: string;
}

export interface Order {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  subtotal: number;
  delivery_cost: number;
  total: number;
  created_at: string;
  notes?: string;
  items: OrderItem[];
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_image?: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  total: number;
}

export interface NovaPoshtaCity {
  Ref: string;
  Description: string;
  DescriptionRu: string;
  Present: string;
  Warehouses?: number;
}

export interface NovaPoshtaWarehouse {
  Ref: string;
  Description: string;
  Number: string;
  TypeOfWarehouse: string;
  CityDescription: string;
}

export interface TrackingInfo {
  Number: string;
  Status: string;
  StatusCode: string;
  WarehouseSender: string;
  WarehouseRecipient: string;
  ScheduledDeliveryDate: string;
}

// Product API
export const productsApi = {
  async getAll(filters?: {
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    sizes?: string[];
    colors?: string[];
    brand?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Product[]> {
    let query = supabase
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .eq("in_stock", true);

    if (filters?.categoryId) {
      query = query.eq("category_id", filters.categoryId);
    }
    if (filters?.minPrice) {
      query = query.gte("price", filters.minPrice);
    }
    if (filters?.maxPrice) {
      query = query.lte("price", filters.maxPrice);
    }
    if (filters?.search) {
      query = query.ilike("name", `%${filters.search}%`);
    }
    if (filters?.brand) {
      query = query.eq("brand", filters.brand);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) throw error;
    return (data as unknown as Product[]) || [];
  },

  async getById(id: string): Promise<Product | null> {
    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .eq("id", id)
      .single();

    if (error) throw error;
    return data as unknown as Product;
  },

  async search(query: string): Promise<Product[]> {
    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .eq("in_stock", true)
      .or(`name.ilike.%${query}%,description.ilike.%${query}%,brand.ilike.%${query}%`)
      .limit(50);

    if (error) throw error;
    return (data as unknown as Product[]) || [];
  },
};

// Categories API
export const categoriesApi = {
  async getAll(): Promise<Category[]> {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<Category | null> {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data;
  },
};

// Orders API
export const ordersApi = {
  async getByProfile(profileId: string): Promise<Order[]> {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        items:order_items(*)
      `)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data as unknown as Order[]) || [];
  },

  async getById(orderId: string): Promise<Order | null> {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        items:order_items(*)
      `)
      .eq("id", orderId)
      .single();

    if (error) throw error;
    return data as unknown as Order;
  },

  async create(order: {
    profileId?: string;
    items: { productId: string; name: string; price: number; quantity: number; size?: string; color?: string; image?: string }[];
    deliveryAddressId?: string;
    paymentMethod: string;
    notes?: string;
    subtotal: number;
    deliveryCost: number;
  }): Promise<Order> {
    // Create order
    const orderNumber = `TV-${Date.now().toString(36).toUpperCase()}`;
    
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        profile_id: order.profileId,
        delivery_address_id: order.deliveryAddressId,
        payment_method: order.paymentMethod,
        notes: order.notes,
        subtotal: order.subtotal,
        delivery_cost: order.deliveryCost,
        total: order.subtotal + order.deliveryCost,
        status: "pending",
        payment_status: "pending",
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Create order items
    const orderItems = order.items.map((item) => ({
      order_id: orderData.id,
      product_id: item.productId,
      product_name: item.name,
      product_image: item.image,
      price: item.price,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
      total: item.price * item.quantity,
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItems);

    if (itemsError) throw itemsError;

    return { ...orderData, items: orderItems } as unknown as Order;
  },
};

// Nova Poshta API
export const novaPoshtaApi = {
  async searchCities(query: string): Promise<NovaPoshtaCity[]> {
    const { data, error } = await supabase.functions.invoke("nova-poshta", {
      body: { action: "searchCity", params: { query } },
    });

    if (error) throw error;
    return data?.data || [];
  },

  async getWarehouses(cityRef: string, type?: string): Promise<NovaPoshtaWarehouse[]> {
    const { data, error } = await supabase.functions.invoke("nova-poshta", {
      body: { action: "getWarehouses", params: { cityRef, type } },
    });

    if (error) throw error;
    return data?.data || [];
  },

  async calculateDelivery(cityRecipient: string, cost: number): Promise<{ cost: number; estimatedDate: string }> {
    const { data, error } = await supabase.functions.invoke("nova-poshta", {
      body: { action: "calculateDelivery", params: { cityRecipient, cost } },
    });

    if (error) throw error;
    const result = data?.data?.[0];
    return {
      cost: result?.Cost || 75,
      estimatedDate: result?.EstimatedDeliveryDate || "",
    };
  },

  async trackPackage(trackingNumber: string): Promise<TrackingInfo | null> {
    const { data, error } = await supabase.functions.invoke("nova-poshta", {
      body: { action: "trackPackage", params: { trackingNumber } },
    });

    if (error) throw error;
    return data?.data?.[0] || null;
  },
};

// Cart API
export const cartApi = {
  async getItems(profileId: string) {
    const { data, error } = await supabase
      .from("cart_items")
      .select(`
        *,
        product:products(id, name, price, images)
      `)
      .eq("profile_id", profileId);

    if (error) throw error;
    return data || [];
  },

  async addItem(profileId: string, item: {
    productId: string;
    quantity: number;
    size?: string;
    color?: string;
  }) {
    // Check if item exists
    const { data: existing } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("profile_id", profileId)
      .eq("product_id", item.productId)
      .eq("size", item.size || "")
      .eq("color", item.color || "")
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("cart_items")
        .update({ quantity: existing.quantity + item.quantity })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("cart_items")
        .insert({
          profile_id: profileId,
          product_id: item.productId,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
        });
      if (error) throw error;
    }
  },

  async updateQuantity(cartItemId: string, quantity: number) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity })
      .eq("id", cartItemId);

    if (error) throw error;
  },

  async removeItem(cartItemId: string) {
    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", cartItemId);

    if (error) throw error;
  },

  async clearCart(profileId: string) {
    const { error } = await supabase
      .from("cart_items")
      .delete()
      .eq("profile_id", profileId);

    if (error) throw error;
  },
};

// Affiliate/Referral API (Mock for now)
export const affiliateApi = {
  async getBalance(profileId: string): Promise<number> {
    // Mock implementation - will be replaced with real API
    return 150; // 150 UAH bonus
  },

  async getReferralLink(profileId: string): Promise<string> {
    const botUsername = "TavernaBot";
    return `https://t.me/${botUsername}/app?startapp=ref_${profileId.slice(0, 8)}`;
  },

  async getReferralCount(profileId: string): Promise<number> {
    // Mock implementation
    return 3;
  },
};

// Reviews API
export const reviewsApi = {
  async getByProduct(productId: string) {
    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(review: {
    productId: string;
    sessionToken: string;
    rating: number;
    title?: string;
    content?: string;
  }) {
    const { data, error } = await supabase.functions.invoke('telegram-auth', {
      body: {
        action: 'create_review',
        session_token: review.sessionToken,
        product_id: review.productId,
        rating: review.rating,
        title: review.title,
        content: review.content,
      },
    });

    if (error || !data?.success) {
      throw new Error(data?.error || 'Failed to create review');
    }
    return data.review;
  },
};
