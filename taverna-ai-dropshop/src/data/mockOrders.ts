/**
 * Mock orders for testing all order interactions
 */

export interface MockOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_image: string;
  price: number;
  quantity: number;
  size: string | null;
  color: string | null;
  total: number;
}

export interface MockOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string;
  subtotal: number;
  delivery_cost: number;
  total: number;
  notes: string | null;
  delivery_tracking: string | null;
  delivery_service: string;
  created_at: string;
  updated_at: string;
  items: MockOrderItem[];
  delivery_address: {
    city: string;
    warehouse_number: string | null;
    street_address: string | null;
    building_number: string | null;
    recipient_name: string;
    phone: string;
  };
}

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

export const MOCK_ORDERS: MockOrder[] = [
  {
    id: "mock-order-001",
    order_number: "TAV-20260228-000001",
    status: "delivered",
    payment_status: "paid",
    payment_method: "card",
    subtotal: 54999,
    delivery_cost: 75,
    total: 55074,
    notes: null,
    delivery_tracking: "20450000000001",
    delivery_service: "nova_poshta",
    created_at: daysAgo(7),
    updated_at: daysAgo(1),
    items: [
      {
        id: "item-001",
        product_id: "a0000001-0001-0001-0001-000000000001",
        product_name: "Samsung Galaxy S24 Ultra",
        product_image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=800",
        price: 54999,
        quantity: 1,
        size: null,
        color: "Titanium Gray",
        total: 54999,
      },
    ],
    delivery_address: {
      city: "Київ",
      warehouse_number: "1",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-002",
    order_number: "TAV-20260226-000002",
    status: "shipped",
    payment_status: "paid",
    payment_method: "cod",
    subtotal: 7098,
    delivery_cost: 75,
    total: 7173,
    notes: "Зателефонуйте перед доставкою",
    delivery_tracking: "20450000000002",
    delivery_service: "nova_poshta",
    created_at: daysAgo(5),
    updated_at: daysAgo(2),
    items: [
      {
        id: "item-002",
        product_id: "c0000003-0003-0003-0003-000000000001",
        product_name: "Тактичний рюкзак Assault 45L",
        product_image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800",
        price: 4299,
        quantity: 1,
        size: null,
        color: "Multicam",
        total: 4299,
      },
      {
        id: "item-003",
        product_id: "b0000002-0002-0002-0002-000000000002",
        product_name: "Футболка Oversize Cotton",
        product_image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800",
        price: 899,
        quantity: 1,
        size: "L",
        color: "Black",
        total: 899,
      },
      {
        id: "item-003b",
        product_id: "b0000002-0002-0002-0002-000000000003",
        product_name: "Джинси Slim Fit Premium",
        product_image: "https://images.unsplash.com/photo-1542272604-787c3835535d?w=800",
        price: 1900,
        quantity: 1,
        size: "32",
        color: "Indigo",
        total: 1900,
      },
    ],
    delivery_address: {
      city: "Львів",
      warehouse_number: "25",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-003",
    order_number: "TAV-20260228-000003",
    status: "processing",
    payment_status: "paid",
    payment_method: "card",
    subtotal: 89999,
    delivery_cost: 0,
    total: 89999,
    notes: null,
    delivery_tracking: null,
    delivery_service: "nova_poshta",
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    items: [
      {
        id: "item-004",
        product_id: "a0000001-0001-0001-0001-000000000004",
        product_name: "MacBook Pro 14\" M3 Pro",
        product_image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800",
        price: 89999,
        quantity: 1,
        size: null,
        color: "Space Black",
        total: 89999,
      },
    ],
    delivery_address: {
      city: "Одеса",
      warehouse_number: "12",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-004",
    order_number: "TAV-20260220-000004",
    status: "pending",
    payment_status: "pending",
    payment_method: "cod",
    subtotal: 8999,
    delivery_cost: 75,
    total: 9074,
    notes: "Подарунок, упакуйте гарно",
    delivery_tracking: null,
    delivery_service: "ukrposhta",
    created_at: daysAgo(0),
    updated_at: daysAgo(0),
    items: [
      {
        id: "item-005",
        product_id: "d0000004-0004-0004-0004-000000000001",
        product_name: "Конструктор LEGO Technic Porsche 911",
        product_image: "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800",
        price: 8999,
        quantity: 1,
        size: null,
        color: null,
        total: 8999,
      },
    ],
    delivery_address: {
      city: "Харків",
      warehouse_number: "8",
      street_address: null,
      building_number: null,
      recipient_name: "Марія Тестова",
      phone: "+380671234567",
    },
  },
  {
    id: "mock-order-005",
    order_number: "TAV-20260210-000005",
    status: "cancelled",
    payment_status: "refunded",
    payment_method: "card",
    subtotal: 5999,
    delivery_cost: 75,
    total: 6074,
    notes: "Скасовано за бажанням клієнта",
    delivery_tracking: null,
    delivery_service: "nova_poshta",
    created_at: daysAgo(18),
    updated_at: daysAgo(16),
    items: [
      {
        id: "item-006",
        product_id: "c0000003-0003-0003-0003-000000000002",
        product_name: "Тактичні черевики Desert Storm",
        product_image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800",
        price: 5999,
        quantity: 1,
        size: "43",
        color: "Coyote",
        total: 5999,
      },
    ],
    delivery_address: {
      city: "Дніпро",
      warehouse_number: "5",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-006",
    order_number: "TAV-20260215-000006",
    status: "received",
    payment_status: "paid",
    payment_method: "card",
    subtotal: 12500,
    delivery_cost: 0,
    total: 12500,
    notes: null,
    delivery_tracking: "20450000000006",
    delivery_service: "nova_poshta",
    created_at: daysAgo(10),
    updated_at: daysAgo(3),
    items: [
      {
        id: "item-007",
        product_id: "a0000001-0001-0001-0001-000000000007",
        product_name: "Навушники Sony WH-1000XM5",
        product_image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800",
        price: 12500,
        quantity: 1,
        size: null,
        color: "Black",
        total: 12500,
      },
    ],
    delivery_address: {
      city: "Київ",
      warehouse_number: "15",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-007",
    order_number: "TAV-20260218-000007",
    status: "exchange",
    payment_status: "paid",
    payment_method: "card",
    subtotal: 3200,
    delivery_cost: 75,
    total: 3275,
    notes: "Обмін на інший розмір",
    delivery_tracking: "20450000000007",
    delivery_service: "nova_poshta",
    created_at: daysAgo(12),
    updated_at: daysAgo(5),
    items: [
      {
        id: "item-008",
        product_id: "b0000002-0002-0002-0002-000000000008",
        product_name: "Кросівки Nike Air Max 90",
        product_image: "https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=800",
        price: 3200,
        quantity: 1,
        size: "42",
        color: "White",
        total: 3200,
      },
    ],
    delivery_address: {
      city: "Львів",
      warehouse_number: "10",
      street_address: null,
      building_number: null,
      recipient_name: "Іван Тестовий",
      phone: "+380991234567",
    },
  },
  {
    id: "mock-order-008",
    order_number: "TAV-20260220-000008",
    status: "return",
    payment_status: "pending",
    payment_method: "card",
    subtotal: 7800,
    delivery_cost: 75,
    total: 7875,
    notes: "Повернення — товар не підійшов",
    delivery_tracking: "20450000000008",
    delivery_service: "nova_poshta",
    created_at: daysAgo(8),
    updated_at: daysAgo(2),
    items: [
      {
        id: "item-009",
        product_id: "d0000004-0004-0004-0004-000000000009",
        product_name: "Розумний годинник Garmin Venu 3",
        product_image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800",
        price: 7800,
        quantity: 1,
        size: null,
        color: "Silver",
        total: 7800,
      },
    ],
    delivery_address: {
      city: "Одеса",
      warehouse_number: "7",
      street_address: null,
      building_number: null,
      recipient_name: "Марія Тестова",
      phone: "+380671234567",
    },
  },
];
