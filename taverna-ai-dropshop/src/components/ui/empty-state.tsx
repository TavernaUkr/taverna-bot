import { motion } from "framer-motion";
import { Package, Search, Filter, ShoppingCart, Heart, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  type?: "search" | "products" | "cart" | "favorites" | "inbox" | "default";
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const illustrations = {
  search: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="emptyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#emptyGrad)" />
      <circle cx="85" cy="85" r="35" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="6" strokeOpacity="0.3" />
      <line x1="110" y1="110" x2="140" y2="140" stroke="hsl(var(--muted-foreground))" strokeWidth="6" strokeLinecap="round" strokeOpacity="0.3" />
      <circle cx="85" cy="85" r="15" fill="hsl(var(--primary))" fillOpacity="0.2" />
    </svg>
  ),
  products: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="boxGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="40" y="60" width="120" height="100" rx="8" fill="url(#boxGrad)" />
      <rect x="50" y="40" width="100" height="30" rx="4" fill="hsl(var(--muted-foreground))" fillOpacity="0.2" />
      <path d="M60 90 L100 110 L140 90" stroke="hsl(var(--muted-foreground))" strokeWidth="4" fill="none" strokeOpacity="0.3" strokeLinecap="round" />
      <line x1="100" y1="110" x2="100" y2="140" stroke="hsl(var(--muted-foreground))" strokeWidth="4" strokeOpacity="0.3" strokeLinecap="round" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="cartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#cartGrad)" />
      <path d="M50 60 L70 60 L90 120 L150 120" stroke="hsl(var(--muted-foreground))" strokeWidth="6" fill="none" strokeOpacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="100" cy="145" r="10" fill="hsl(var(--muted-foreground))" fillOpacity="0.3" />
      <circle cx="135" cy="145" r="10" fill="hsl(var(--muted-foreground))" fillOpacity="0.3" />
      <rect x="75" y="75" width="60" height="35" rx="4" fill="hsl(var(--primary))" fillOpacity="0.2" />
    </svg>
  ),
  favorites: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="heartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--live))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#heartGrad)" />
      <path 
        d="M100 150 C60 120 40 90 60 70 C80 50 100 70 100 70 C100 70 120 50 140 70 C160 90 140 120 100 150Z" 
        fill="none" 
        stroke="hsl(var(--muted-foreground))" 
        strokeWidth="5" 
        strokeOpacity="0.3"
        strokeLinejoin="round"
      />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="inboxGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="30" y="50" width="140" height="100" rx="10" fill="url(#inboxGrad)" />
      <path d="M30 80 L100 120 L170 80" stroke="hsl(var(--muted-foreground))" strokeWidth="4" fill="none" strokeOpacity="0.3" strokeLinecap="round" />
      <line x1="30" y1="80" x2="30" y2="50" stroke="hsl(var(--muted-foreground))" strokeWidth="4" strokeOpacity="0.3" />
      <line x1="170" y1="80" x2="170" y2="50" stroke="hsl(var(--muted-foreground))" strokeWidth="4" strokeOpacity="0.3" />
    </svg>
  ),
  default: (
    <svg viewBox="0 0 200 200" className="w-40 h-40">
      <defs>
        <linearGradient id="defaultGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--muted))" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#defaultGrad)" />
      <circle cx="100" cy="100" r="40" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="4" strokeOpacity="0.2" strokeDasharray="10 5" />
    </svg>
  ),
};

const icons = {
  search: Search,
  products: Package,
  cart: ShoppingCart,
  favorites: Heart,
  inbox: Inbox,
  default: Package,
};

const defaultContent = {
  search: {
    title: "Нічого не знайдено",
    description: "Спробуйте змінити параметри пошуку або скиньте фільтри",
  },
  products: {
    title: "Товарів поки немає",
    description: "Скоро тут з'являться нові пропозиції",
  },
  cart: {
    title: "Кошик порожній",
    description: "Додайте товари, які вам сподобались",
  },
  favorites: {
    title: "Список бажань порожній",
    description: "Додавайте товари до обраного, щоб не загубити їх",
  },
  inbox: {
    title: "Повідомлень немає",
    description: "Тут з'являться ваші сповіщення",
  },
  default: {
    title: "Тут поки порожньо",
    description: "Дані з'являться пізніше",
  },
};

export function EmptyState({
  type = "default",
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const Icon = icons[type];
  const content = defaultContent[type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
    >
      {/* Illustration */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mb-6"
      >
        {illustrations[type]}
      </motion.div>

      {/* Icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4"
      >
        <Icon className="w-7 h-7 text-muted-foreground" />
      </motion.div>

      {/* Text */}
      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-lg font-semibold text-foreground mb-2"
      >
        {title || content.title}
      </motion.h3>
      
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-sm text-muted-foreground max-w-xs mb-6"
      >
        {description || content.description}
      </motion.p>

      {/* Action Button */}
      {action && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Button onClick={action.onClick} variant="outline" className="gap-2">
            <Filter className="w-4 h-4" />
            {action.label}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
