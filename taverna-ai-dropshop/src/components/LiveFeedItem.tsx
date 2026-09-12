import { User, ShoppingBag, UserPlus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type FeedEventType = "purchase" | "registration" | "return";

interface LiveFeedItemProps {
  type: FeedEventType;
  username: string;
  amount?: number;
  productName?: string;
  timestamp: Date;
}

const eventConfig: Record<FeedEventType, { icon: React.ReactNode; color: string; text: (props: LiveFeedItemProps) => string }> = {
  purchase: {
    icon: <ShoppingBag className="h-4 w-4" />,
    color: "bg-success/10 text-success",
    text: (props) => `купив(ла) "${props.productName}" за ${props.amount?.toLocaleString()} ₴`,
  },
  registration: {
    icon: <UserPlus className="h-4 w-4" />,
    color: "bg-primary/10 text-primary",
    text: () => "приєднався(лась) до Taverna",
  },
  return: {
    icon: <RefreshCw className="h-4 w-4" />,
    color: "bg-warning/10 text-warning",
    text: (props) => `оформив(ла) повернення на ${props.amount?.toLocaleString()} ₴`,
  },
};

// Mask username for privacy
const maskUsername = (name: string) => {
  if (name.length <= 3) return name + "***";
  return name.slice(0, 3) + "***";
};

// Format relative time
const formatRelativeTime = (date: Date) => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "щойно";
  if (diffMin < 60) return `${diffMin} хв тому`;
  if (diffHour < 24) return `${diffHour} год тому`;
  return date.toLocaleDateString("uk-UA");
};

export const LiveFeedItem = (props: LiveFeedItemProps) => {
  const { type, username, timestamp } = props;
  const config = eventConfig[type];

  return (
    <div className="flex items-start gap-3 p-2.5 bg-card rounded-xl border border-border">
      {/* Icon */}
      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", config.color)}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium text-foreground">{maskUsername(username)}</span>{" "}
          <span className="text-muted-foreground">{config.text(props)}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatRelativeTime(timestamp)}
        </p>
      </div>
    </div>
  );
};
