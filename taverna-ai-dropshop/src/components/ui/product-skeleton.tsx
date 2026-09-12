import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border/50 animate-pulse">
      {/* Image skeleton */}
      <div className="aspect-square bg-muted" />
      
      {/* Content skeleton */}
      <div className="p-3 space-y-3">
        {/* Category badge */}
        <Skeleton className="h-5 w-20 rounded-full" />
        
        {/* Title */}
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        
        {/* Price */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-14" />
        </div>
        
        {/* Sizes/Colors */}
        <div className="flex gap-1">
          <Skeleton className="h-6 w-8 rounded" />
          <Skeleton className="h-6 w-8 rounded" />
          <Skeleton className="h-6 w-8 rounded" />
        </div>
        
        {/* Button */}
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProductDetailSkeleton() {
  return (
    <div className="min-h-screen bg-background animate-pulse">
      {/* Header skeleton */}
      <div className="sticky top-0 z-40 bg-card border-b border-border h-14 flex items-center justify-between px-4">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
      </div>
      
      {/* Image skeleton */}
      <Skeleton className="aspect-square w-full" />
      
      {/* Content skeleton */}
      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        
        <Skeleton className="h-8 w-3/4" />
        
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
