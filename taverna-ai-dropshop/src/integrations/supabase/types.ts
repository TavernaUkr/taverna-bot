export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_order_reports: {
        Row: {
          ai_summary: string | null
          created_at: string
          id: string
          order_id: string | null
          report_type: string
          sentiment_score: number | null
          supplier_id: string | null
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          report_type?: string
          sentiment_score?: number | null
          supplier_id?: string | null
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          report_type?: string
          sentiment_score?: number | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_order_reports_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      app_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          order_id: string | null
          profile_id: string | null
          rated_profile_id: string | null
          rating: number
          rating_type: string
          target_id: string | null
          ticket_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          profile_id?: string | null
          rated_profile_id?: string | null
          rating?: number
          rating_type?: string
          target_id?: string | null
          ticket_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          profile_id?: string | null
          rated_profile_id?: string | null
          rating?: number
          rating_type?: string
          target_id?: string | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_ratings_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_promotion_queue: {
        Row: {
          created_at: string
          id: string
          last_promoted_at: string | null
          position: number
          supplier_id: string
          total_promotions: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_promoted_at?: string | null
          position: number
          supplier_id: string
          total_promotions?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          last_promoted_at?: string | null
          position?: number
          supplier_id?: string
          total_promotions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_promotion_queue_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_promotion_queue_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      balance_movements: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          description: string | null
          external_tx_id: string | null
          id: string
          order_split_id: string | null
          provider: string
          status: string
          supplier_id: string
          type: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          external_tx_id?: string | null
          id?: string
          order_split_id?: string | null
          provider?: string
          status?: string
          supplier_id: string
          type: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          external_tx_id?: string | null
          id?: string
          order_split_id?: string | null
          provider?: string
          status?: string
          supplier_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_movements_order_split_id_fkey"
            columns: ["order_split_id"]
            isOneToOne: false
            referencedRelation: "order_splits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          product_id: string | null
          profile_id: string | null
          quantity: number
          size: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          profile_id?: string | null
          quantity?: number
          size?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          profile_id?: string | null
          quantity?: number
          size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          external_id: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          parent_id: string | null
          product_count: number | null
          slug: string
          telegram_channel_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          parent_id?: string | null
          product_count?: number | null
          slug: string
          telegram_channel_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          parent_id?: string | null
          product_count?: number | null
          slug?: string
          telegram_channel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_addresses: {
        Row: {
          apartment: string | null
          building_number: string | null
          city: string
          city_ref: string | null
          created_at: string
          delivery_service: string
          delivery_type: string
          id: string
          is_default: boolean | null
          notes: string | null
          phone: string
          postal_code: string | null
          profile_id: string | null
          recipient_name: string
          street_address: string | null
          updated_at: string
          warehouse_number: string | null
          warehouse_ref: string | null
        }
        Insert: {
          apartment?: string | null
          building_number?: string | null
          city: string
          city_ref?: string | null
          created_at?: string
          delivery_service: string
          delivery_type: string
          id?: string
          is_default?: boolean | null
          notes?: string | null
          phone: string
          postal_code?: string | null
          profile_id?: string | null
          recipient_name: string
          street_address?: string | null
          updated_at?: string
          warehouse_number?: string | null
          warehouse_ref?: string | null
        }
        Update: {
          apartment?: string | null
          building_number?: string | null
          city?: string
          city_ref?: string | null
          created_at?: string
          delivery_service?: string
          delivery_type?: string
          id?: string
          is_default?: boolean | null
          notes?: string | null
          phone?: string
          postal_code?: string | null
          profile_id?: string | null
          recipient_name?: string
          street_address?: string | null
          updated_at?: string
          warehouse_number?: string | null
          warehouse_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_addresses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_addresses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      import_logs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          failed_products: number | null
          id: string
          imported_products: number | null
          started_at: string
          status: string
          supplier_id: string | null
          total_products: number | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          failed_products?: number | null
          id?: string
          imported_products?: number | null
          started_at?: string
          status: string
          supplier_id?: string | null
          total_products?: number | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          failed_products?: number | null
          id?: string
          imported_products?: number | null
          started_at?: string
          status?: string
          supplier_id?: string | null
          total_products?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_logs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_logs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          order_id: string | null
          price: number
          product_id: string | null
          product_image: string | null
          product_name: string
          quantity: number
          size: string | null
          total: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          price: number
          product_id?: string | null
          product_image?: string | null
          product_name: string
          quantity?: number
          size?: string | null
          total: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          price?: number
          product_id?: string | null
          product_image?: string | null
          product_name?: string
          quantity?: number
          size?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          amount: number
          bonus_amount: number
          comment: string | null
          created_at: string
          id: string
          items: Json
          order_id: string
          paid_at: string | null
          processed_by: string | null
          profile_id: string
          reason: string
          refund_method_id: string | null
          refund_target: string | null
          rejection_reason: string | null
          status: string
          supplier_id: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          bonus_amount?: number
          comment?: string | null
          created_at?: string
          id?: string
          items?: Json
          order_id: string
          paid_at?: string | null
          processed_by?: string | null
          profile_id: string
          reason: string
          refund_method_id?: string | null
          refund_target?: string | null
          rejection_reason?: string | null
          status?: string
          supplier_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bonus_amount?: number
          comment?: string | null
          created_at?: string
          id?: string
          items?: Json
          order_id?: string
          paid_at?: string | null
          processed_by?: string | null
          profile_id?: string
          reason?: string
          refund_method_id?: string | null
          refund_target?: string | null
          rejection_reason?: string | null
          status?: string
          supplier_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_refund_method_id_fkey"
            columns: ["refund_method_id"]
            isOneToOne: false
            referencedRelation: "refund_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_refunds_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_splits: {
        Row: {
          balance_movement_id: string | null
          created_at: string
          eligible_payout_at: string | null
          id: string
          is_returnable: boolean | null
          markup_percentage: number
          order_id: string
          paid_at: string | null
          payment_method: string
          payout_stage: string
          payout_type: string | null
          platform_commission: number
          product_total: number
          receipt_uploaded_at: string | null
          receipt_url: string | null
          split_status: string
          supplier_amount: number
          supplier_id: string
          updated_at: string
        }
        Insert: {
          balance_movement_id?: string | null
          created_at?: string
          eligible_payout_at?: string | null
          id?: string
          is_returnable?: boolean | null
          markup_percentage?: number
          order_id: string
          paid_at?: string | null
          payment_method?: string
          payout_stage?: string
          payout_type?: string | null
          platform_commission?: number
          product_total?: number
          receipt_uploaded_at?: string | null
          receipt_url?: string | null
          split_status?: string
          supplier_amount?: number
          supplier_id: string
          updated_at?: string
        }
        Update: {
          balance_movement_id?: string | null
          created_at?: string
          eligible_payout_at?: string | null
          id?: string
          is_returnable?: boolean | null
          markup_percentage?: number
          order_id?: string
          paid_at?: string | null
          payment_method?: string
          payout_stage?: string
          payout_type?: string | null
          platform_commission?: number
          product_total?: number
          receipt_uploaded_at?: string | null
          receipt_url?: string | null
          split_status?: string
          supplier_amount?: number
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_splits_balance_movement_id_fkey"
            columns: ["balance_movement_id"]
            isOneToOne: false
            referencedRelation: "balance_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_splits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_splits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_splits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          delivery_address_id: string | null
          delivery_cost: number | null
          delivery_service: string | null
          delivery_tracking: string | null
          id: string
          notes: string | null
          order_number: string | null
          payment_method: string | null
          payment_status: string | null
          profile_id: string | null
          received_at: string | null
          status: string | null
          subtotal: number
          total: number
          tracking_status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_address_id?: string | null
          delivery_cost?: number | null
          delivery_service?: string | null
          delivery_tracking?: string | null
          id?: string
          notes?: string | null
          order_number?: string | null
          payment_method?: string | null
          payment_status?: string | null
          profile_id?: string | null
          received_at?: string | null
          status?: string | null
          subtotal: number
          total: number
          tracking_status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_address_id?: string | null
          delivery_cost?: number | null
          delivery_service?: string | null
          delivery_tracking?: string | null
          id?: string
          notes?: string | null
          order_number?: string | null
          payment_method?: string | null
          payment_status?: string | null
          profile_id?: string | null
          received_at?: string | null
          status?: string | null
          subtotal?: number
          total?: number
          tracking_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_delivery_address_id_fkey"
            columns: ["delivery_address_id"]
            isOneToOne: false
            referencedRelation: "delivery_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_methods: {
        Row: {
          auto_charge: boolean
          auto_withdraw: boolean
          card_token: string | null
          created_at: string
          holder: string | null
          iban: string | null
          id: string
          is_default: boolean
          masked_pan: string | null
          min_withdraw: number
          provider: string
          supplier_id: string
          type: string
          updated_at: string
          wallet_address: string | null
          wallet_currency: string | null
        }
        Insert: {
          auto_charge?: boolean
          auto_withdraw?: boolean
          card_token?: string | null
          created_at?: string
          holder?: string | null
          iban?: string | null
          id?: string
          is_default?: boolean
          masked_pan?: string | null
          min_withdraw?: number
          provider?: string
          supplier_id: string
          type?: string
          updated_at?: string
          wallet_address?: string | null
          wallet_currency?: string | null
        }
        Update: {
          auto_charge?: boolean
          auto_withdraw?: boolean
          card_token?: string | null
          created_at?: string
          holder?: string | null
          iban?: string | null
          id?: string
          is_default?: boolean
          masked_pan?: string | null
          min_withdraw?: number
          provider?: string
          supplier_id?: string
          type?: string
          updated_at?: string
          wallet_address?: string | null
          wallet_currency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_methods_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_methods_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          ai_category: string | null
          ai_description: string | null
          ai_tags: string[] | null
          attributes: Json | null
          brand: string | null
          category_id: string | null
          colors: string[] | null
          created_at: string
          currency: string | null
          description: string | null
          external_id: string | null
          group_id: string | null
          id: string
          images: string[] | null
          in_stock: boolean | null
          is_boosted: boolean | null
          is_returnable: boolean
          model: string | null
          name: string
          original_description: string | null
          original_price: number | null
          price: number
          return_window_days: number
          returnability_source: string
          sizes: string[] | null
          source_url: string | null
          stock_quantity: number | null
          supplier_id: string | null
          updated_at: string
          vendor_code: string | null
          video_url: string | null
          views_count: number | null
        }
        Insert: {
          ai_category?: string | null
          ai_description?: string | null
          ai_tags?: string[] | null
          attributes?: Json | null
          brand?: string | null
          category_id?: string | null
          colors?: string[] | null
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id?: string | null
          group_id?: string | null
          id?: string
          images?: string[] | null
          in_stock?: boolean | null
          is_boosted?: boolean | null
          is_returnable?: boolean
          model?: string | null
          name: string
          original_description?: string | null
          original_price?: number | null
          price: number
          return_window_days?: number
          returnability_source?: string
          sizes?: string[] | null
          source_url?: string | null
          stock_quantity?: number | null
          supplier_id?: string | null
          updated_at?: string
          vendor_code?: string | null
          video_url?: string | null
          views_count?: number | null
        }
        Update: {
          ai_category?: string | null
          ai_description?: string | null
          ai_tags?: string[] | null
          attributes?: Json | null
          brand?: string | null
          category_id?: string | null
          colors?: string[] | null
          created_at?: string
          currency?: string | null
          description?: string | null
          external_id?: string | null
          group_id?: string | null
          id?: string
          images?: string[] | null
          in_stock?: boolean | null
          is_boosted?: boolean | null
          is_returnable?: boolean
          model?: string | null
          name?: string
          original_description?: string | null
          original_price?: number | null
          price?: number
          return_window_days?: number
          returnability_source?: string
          sizes?: string[] | null
          source_url?: string | null
          stock_quantity?: number | null
          supplier_id?: string | null
          updated_at?: string
          vendor_code?: string | null
          video_url?: string | null
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          last_city: string | null
          last_city_ref: string | null
          last_name: string | null
          last_warehouse: string | null
          last_warehouse_ref: string | null
          phone: string | null
          referral_code: string | null
          referred_by: string | null
          telegram_id: number | null
          telegram_username: string | null
          updated_at: string
          user_type: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          last_city?: string | null
          last_city_ref?: string | null
          last_name?: string | null
          last_warehouse?: string | null
          last_warehouse_ref?: string | null
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_type?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          last_city?: string | null
          last_city_ref?: string | null
          last_name?: string | null
          last_warehouse?: string | null
          last_warehouse_ref?: string | null
          phone?: string | null
          referral_code?: string | null
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          category_id: string | null
          code: string
          created_at: string | null
          created_by: string | null
          current_uses: number | null
          discount_amount: number | null
          discount_percent: number | null
          id: string
          is_active: boolean | null
          max_uses: number | null
          min_order_amount: number | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          category_id?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_order_amount?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          category_id?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_order_amount?: number | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      promotion_platforms: {
        Row: {
          cost_per_promotion: number | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          cost_per_promotion?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          cost_per_promotion?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          ai_generated_text: string | null
          budget: number | null
          clicks: number | null
          created_at: string
          end_date: string | null
          id: string
          media_images: string[] | null
          media_video: string | null
          orders: number | null
          platforms: string[] | null
          product_id: string | null
          promotion_type: string
          queue_position: number | null
          spent: number | null
          start_date: string | null
          status: string
          supplier_id: string | null
          telegram_channel_id: string | null
          telegram_message_id: number | null
          updated_at: string
          views: number | null
        }
        Insert: {
          ai_generated_text?: string | null
          budget?: number | null
          clicks?: number | null
          created_at?: string
          end_date?: string | null
          id?: string
          media_images?: string[] | null
          media_video?: string | null
          orders?: number | null
          platforms?: string[] | null
          product_id?: string | null
          promotion_type: string
          queue_position?: number | null
          spent?: number | null
          start_date?: string | null
          status?: string
          supplier_id?: string | null
          telegram_channel_id?: string | null
          telegram_message_id?: number | null
          updated_at?: string
          views?: number | null
        }
        Update: {
          ai_generated_text?: string | null
          budget?: number | null
          clicks?: number | null
          created_at?: string
          end_date?: string | null
          id?: string
          media_images?: string[] | null
          media_video?: string | null
          orders?: number | null
          platforms?: string[] | null
          product_id?: string | null
          promotion_type?: string
          queue_position?: number | null
          spent?: number | null
          start_date?: string | null
          status?: string
          supplier_id?: string | null
          telegram_channel_id?: string | null
          telegram_message_id?: number | null
          updated_at?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_rewards: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_id: string | null
          profile_id: string
          reward_type: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string | null
          profile_id: string
          reward_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string | null
          profile_id?: string
          reward_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "rating_rewards_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_methods: {
        Row: {
          bank_name: string | null
          created_at: string
          full_value: string
          holder: string | null
          id: string
          is_default: boolean
          masked_value: string
          method_type: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          full_value: string
          holder?: string | null
          id?: string
          is_default?: boolean
          masked_value: string
          method_type?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          full_value?: string
          holder?: string | null
          id?: string
          is_default?: boolean
          masked_value?: string
          method_type?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_methods_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_methods_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string | null
          id: string
          product_id: string | null
          reason: string
          reporter_profile_id: string | null
          reporter_telegram_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          product_id?: string | null
          reason: string
          reporter_profile_id?: string | null
          reporter_telegram_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          product_id?: string | null
          reason?: string
          reporter_profile_id?: string | null
          reporter_telegram_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_profile_id_fkey"
            columns: ["reporter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          author_name: string
          content: string | null
          created_at: string
          helpful_count: number | null
          id: string
          images: string[] | null
          is_verified_purchase: boolean | null
          product_id: string | null
          profile_id: string | null
          rating: number
          title: string | null
          updated_at: string
        }
        Insert: {
          author_name: string
          content?: string | null
          created_at?: string
          helpful_count?: number | null
          id?: string
          images?: string[] | null
          is_verified_purchase?: boolean | null
          product_id?: string | null
          profile_id?: string | null
          rating: number
          title?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string
          content?: string | null
          created_at?: string
          helpful_count?: number | null
          id?: string
          images?: string[] | null
          is_verified_purchase?: boolean | null
          product_id?: string | null
          profile_id?: string | null
          rating?: number
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_used_at: string
          profile_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string
          profile_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string
          profile_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_balances: {
        Row: {
          available: number
          created_at: string
          currency: string
          id: string
          lifetime_paid: number
          pending: number
          supplier_id: string
          updated_at: string
        }
        Insert: {
          available?: number
          created_at?: string
          currency?: string
          id?: string
          lifetime_paid?: number
          pending?: number
          supplier_id: string
          updated_at?: string
        }
        Update: {
          available?: number
          created_at?: string
          currency?: string
          id?: string
          lifetime_paid?: number
          pending?: number
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_balances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_balances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_manager_links: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          profile_id: string
          supplier_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          profile_id: string
          supplier_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          profile_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_manager_links_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_manager_links_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_applications: {
        Row: {
          ai_analysis: Json | null
          company_name: string | null
          created_at: string
          description: string | null
          email: string
          full_name: string
          id: string
          manager_telegram: string | null
          payment_bank_name: string | null
          payment_card_holder: string | null
          payment_iban: string | null
          phone: string
          plagiarism_score: number | null
          profile_id: string | null
          rejection_reason: string | null
          reseller_probability: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_name: string
          similar_suppliers: Json | null
          status: string
          suggested_categories: string[] | null
          supplier_type: string
          tax_id: string
          telegram_channel: string | null
          telegram_id: number | null
          telegram_username: string | null
          updated_at: string
          xml_url: string | null
        }
        Insert: {
          ai_analysis?: Json | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          email: string
          full_name: string
          id?: string
          manager_telegram?: string | null
          payment_bank_name?: string | null
          payment_card_holder?: string | null
          payment_iban?: string | null
          phone: string
          plagiarism_score?: number | null
          profile_id?: string | null
          rejection_reason?: string | null
          reseller_probability?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_name: string
          similar_suppliers?: Json | null
          status?: string
          suggested_categories?: string[] | null
          supplier_type: string
          tax_id: string
          telegram_channel?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          xml_url?: string | null
        }
        Update: {
          ai_analysis?: Json | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          email?: string
          full_name?: string
          id?: string
          manager_telegram?: string | null
          payment_bank_name?: string | null
          payment_card_holder?: string | null
          payment_iban?: string | null
          phone?: string
          plagiarism_score?: number | null
          profile_id?: string | null
          rejection_reason?: string | null
          reseller_probability?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_name?: string
          similar_suppliers?: Json | null
          status?: string
          suggested_categories?: string[] | null
          supplier_type?: string
          tax_id?: string
          telegram_channel?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_deadlines: {
        Row: {
          amount_due: number
          auto_ban_triggered: boolean
          created_at: string
          deadline_at: string
          id: string
          is_paid: boolean
          order_id: string
          paid_at: string | null
          supplier_id: string
        }
        Insert: {
          amount_due?: number
          auto_ban_triggered?: boolean
          created_at?: string
          deadline_at: string
          id?: string
          is_paid?: boolean
          order_id: string
          paid_at?: string | null
          supplier_id: string
        }
        Update: {
          amount_due?: number
          auto_ban_triggered?: boolean
          created_at?: string
          deadline_at?: string
          id?: string
          is_paid?: boolean
          order_id?: string
          paid_at?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_deadlines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_deadlines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_deadlines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payouts: {
        Row: {
          amount: number
          created_at: string
          error_message: string | null
          iban: string | null
          id: string
          order_split_id: string | null
          payout_method: string
          payout_status: string
          processed_at: string | null
          scheduled_at: string | null
          supplier_id: string
          transaction_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          error_message?: string | null
          iban?: string | null
          id?: string
          order_split_id?: string | null
          payout_method?: string
          payout_status?: string
          processed_at?: string | null
          scheduled_at?: string | null
          supplier_id: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          error_message?: string | null
          iban?: string | null
          id?: string
          order_split_id?: string | null
          payout_method?: string
          payout_status?: string
          processed_at?: string | null
          scheduled_at?: string | null
          supplier_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payouts_order_split_id_fkey"
            columns: ["order_split_id"]
            isOneToOne: false
            referencedRelation: "order_splits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payouts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payouts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          allow_bot_chat: boolean | null
          company_name: string
          contact_email: string | null
          contact_name: string
          contact_phone: string
          cover_image_url: string | null
          created_at: string
          description: string | null
          exchange_policy: string | null
          id: string
          is_active: boolean | null
          legal_type: string
          logo_url: string | null
          manager_telegram: string | null
          markup_percentage: number | null
          payment_bank_name: string | null
          payment_card_holder: string | null
          payment_iban: string | null
          return_contact_info: string | null
          return_policy: string | null
          shipping_days: string[] | null
          shipping_schedule: string | null
          shop_name: string
          shop_photos: string[] | null
          tax_code: string | null
          telegram_channel_url: string | null
          telegram_forward_enabled: boolean | null
          telegram_id: number | null
          updated_at: string
          website_url: string | null
          xml_url: string | null
        }
        Insert: {
          allow_bot_chat?: boolean | null
          company_name: string
          contact_email?: string | null
          contact_name: string
          contact_phone: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          exchange_policy?: string | null
          id?: string
          is_active?: boolean | null
          legal_type: string
          logo_url?: string | null
          manager_telegram?: string | null
          markup_percentage?: number | null
          payment_bank_name?: string | null
          payment_card_holder?: string | null
          payment_iban?: string | null
          return_contact_info?: string | null
          return_policy?: string | null
          shipping_days?: string[] | null
          shipping_schedule?: string | null
          shop_name: string
          shop_photos?: string[] | null
          tax_code?: string | null
          telegram_channel_url?: string | null
          telegram_forward_enabled?: boolean | null
          telegram_id?: number | null
          updated_at?: string
          website_url?: string | null
          xml_url?: string | null
        }
        Update: {
          allow_bot_chat?: boolean | null
          company_name?: string
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          exchange_policy?: string | null
          id?: string
          is_active?: boolean | null
          legal_type?: string
          logo_url?: string | null
          manager_telegram?: string | null
          markup_percentage?: number | null
          payment_bank_name?: string | null
          payment_card_holder?: string | null
          payment_iban?: string | null
          return_contact_info?: string | null
          return_policy?: string | null
          shipping_days?: string[] | null
          shipping_schedule?: string | null
          shop_name?: string
          shop_photos?: string[] | null
          tax_code?: string | null
          telegram_channel_url?: string | null
          telegram_forward_enabled?: boolean | null
          telegram_id?: number | null
          updated_at?: string
          website_url?: string | null
          xml_url?: string | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          related_order_id: string | null
          status: string
          supplier_id: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          related_order_id?: string | null
          status?: string
          supplier_id?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          related_order_id?: string | null
          status?: string
          supplier_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          created_at: string
          id: string
          message_text: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_text: string
          sender_role: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_text?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      used_promo_codes: {
        Row: {
          id: string
          order_id: string | null
          profile_id: string
          promo_code_id: string | null
          used_at: string | null
        }
        Insert: {
          id?: string
          order_id?: string | null
          profile_id: string
          promo_code_id?: string | null
          used_at?: string | null
        }
        Update: {
          id?: string
          order_id?: string | null
          profile_id?: string
          promo_code_id?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "used_promo_codes_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_auto_queues: {
        Row: {
          active_hours_end: number | null
          active_hours_start: number | null
          budget: number | null
          created_at: string
          current_position: number
          end_date: string | null
          id: string
          interval_minutes: number
          is_paused: boolean
          last_executed_at: string | null
          mode: string
          name: string
          next_execution_at: string | null
          platforms: string[]
          product_ids: string[]
          profile_id: string
          start_date: string | null
          supplier_ids: string[]
          total_published: number
          type: string
          updated_at: string
        }
        Insert: {
          active_hours_end?: number | null
          active_hours_start?: number | null
          budget?: number | null
          created_at?: string
          current_position?: number
          end_date?: string | null
          id?: string
          interval_minutes?: number
          is_paused?: boolean
          last_executed_at?: string | null
          mode: string
          name?: string
          next_execution_at?: string | null
          platforms?: string[]
          product_ids?: string[]
          profile_id: string
          start_date?: string | null
          supplier_ids?: string[]
          total_published?: number
          type: string
          updated_at?: string
        }
        Update: {
          active_hours_end?: number | null
          active_hours_start?: number | null
          budget?: number | null
          created_at?: string
          current_position?: number
          end_date?: string | null
          id?: string
          interval_minutes?: number
          is_paused?: boolean
          last_executed_at?: string | null
          mode?: string
          name?: string
          next_execution_at?: string | null
          platforms?: string[]
          product_ids?: string[]
          profile_id?: string
          start_date?: string | null
          supplier_ids?: string[]
          total_published?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_bans: {
        Row: {
          banned_at: string
          banned_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          profile_id: string
          reason: string
        }
        Insert: {
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          profile_id: string
          reason: string
        }
        Update: {
          banned_at?: string
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          profile_id?: string
          reason?: string
        }
        Relationships: []
      }
      user_bonuses: {
        Row: {
          balance: number | null
          created_at: string | null
          id: string
          profile_id: string
          total_earned: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          id?: string
          profile_id: string
          total_earned?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          id?: string
          profile_id?: string
          total_earned?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          direct_pay_link: string | null
          id: string
          mode: string
          order_id: string | null
          paid_at: string | null
          pay_link: string | null
          profile_id: string | null
          raw_payload: Json | null
          status: string
          updated_at: string
          wallet_invoice_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          direct_pay_link?: string | null
          id?: string
          mode?: string
          order_id?: string | null
          paid_at?: string | null
          pay_link?: string | null
          profile_id?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
          wallet_invoice_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          direct_pay_link?: string | null
          id?: string
          mode?: string
          order_id?: string | null
          paid_at?: string | null
          pay_link?: string | null
          profile_id?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
          wallet_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_invoices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_invoices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_limits: {
        Row: {
          created_at: string
          daily_limit: number
          eta_text: string | null
          fee_fixed: number
          fee_percent: number
          id: string
          is_active: boolean
          max_payout: number
          min_payout: number
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          eta_text?: string | null
          fee_fixed?: number
          fee_percent?: number
          id?: string
          is_active?: boolean
          max_payout?: number
          min_payout?: number
          provider: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_limit?: number
          eta_text?: string | null
          fee_fixed?: number
          fee_percent?: number
          id?: string
          is_active?: boolean
          max_payout?: number
          min_payout?: number
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          bonus_amount: number
          created_at: string
          description: string | null
          external_id: string | null
          id: string
          order_id: string | null
          provider: string
          receipt: Json | null
          status: string
          type: string
          updated_at: string
          wallet_id: string
        }
        Insert: {
          amount?: number
          bonus_amount?: number
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider?: string
          receipt?: Json | null
          status?: string
          type: string
          updated_at?: string
          wallet_id: string
        }
        Update: {
          amount?: number
          bonus_amount?: number
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          order_id?: string | null
          provider?: string
          receipt?: Json | null
          status?: string
          type?: string
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          auto_withdraw: boolean
          auto_withdraw_min: number
          balance: number
          bonus_balance: number
          created_at: string
          currency: string
          id: string
          is_connected: boolean
          owner_id: string
          owner_type: string
          payout_provider: string
          pending: number
          tg_wallet_address: string | null
          tg_wallet_currency: string | null
          updated_at: string
        }
        Insert: {
          auto_withdraw?: boolean
          auto_withdraw_min?: number
          balance?: number
          bonus_balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_connected?: boolean
          owner_id: string
          owner_type: string
          payout_provider?: string
          pending?: number
          tg_wallet_address?: string | null
          tg_wallet_currency?: string | null
          updated_at?: string
        }
        Update: {
          auto_withdraw?: boolean
          auto_withdraw_min?: number
          balance?: number
          bonus_balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_connected?: boolean
          owner_id?: string
          owner_type?: string
          payout_provider?: string
          pending?: number
          tg_wallet_address?: string | null
          tg_wallet_currency?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_safe: {
        Row: {
          avatar_url: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          referral_code: string | null
          referred_by: string | null
          user_type: string | null
        }
        Insert: {
          avatar_url?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          referral_code?: string | null
          referred_by?: string | null
          user_type?: string | null
        }
        Update: {
          avatar_url?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          referral_code?: string | null
          referred_by?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers_public: {
        Row: {
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          exchange_policy: string | null
          id: string | null
          is_active: boolean | null
          logo_url: string | null
          markup_percentage: number | null
          return_policy: string | null
          shipping_days: string[] | null
          shipping_schedule: string | null
          shop_name: string | null
          shop_photos: string[] | null
          telegram_channel_url: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          exchange_policy?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          markup_percentage?: number | null
          return_policy?: string | null
          shipping_days?: string[] | null
          shipping_schedule?: string | null
          shop_name?: string | null
          shop_photos?: string[] | null
          telegram_channel_url?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          exchange_policy?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          markup_percentage?: number | null
          return_policy?: string | null
          shipping_days?: string[] | null
          shipping_schedule?: string | null
          shop_name?: string | null
          shop_photos?: string[] | null
          telegram_channel_url?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "supplier" | "customer" | "shop_manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "supplier", "customer", "shop_manager"],
    },
  },
} as const
