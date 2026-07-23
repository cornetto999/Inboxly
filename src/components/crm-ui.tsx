import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<LucideProps>;

const pageWidths = {
  default: "max-w-7xl",
  narrow: "max-w-4xl",
  wide: "max-w-none",
} as const;

export function PageShell({
  children,
  className,
  width = "default",
}: HTMLAttributes<HTMLDivElement> & {
  width?: keyof typeof pageWidths;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full min-w-0 p-3 sm:p-5 lg:p-8",
        pageWidths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function MetricStrip({
  items,
  className,
}: HTMLAttributes<HTMLDivElement> & {
  items: {
    label: ReactNode;
    value: ReactNode;
    valueClassName?: string;
  }[];
}) {
  return (
    <Card className={cn("w-fit px-4 py-3 shadow-sm", className)}>
      <div className="flex items-center gap-4 text-sm">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-4">
            {index > 0 && <Separator orientation="vertical" className="h-8" />}
            <div>
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div
                className={cn(
                  "font-semibold tabular-nums text-foreground",
                  item.valueClassName,
                )}
              >
                {item.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ToolbarCard({
  children,
  className,
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={cn("mb-4 border-border/80 shadow-sm", className)}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export function DataCard({
  children,
  className,
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      className={cn("overflow-hidden border-border/80 shadow-sm", className)}
    >
      {children}
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & {
  icon: IconComponent;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Card className={cn("border-dashed p-12 text-center shadow-sm", className)}>
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </Card>
  );
}

export function FormPanel({
  icon: Icon,
  title,
  description,
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Card className={cn("h-fit border-border/80 shadow-sm", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && (
              <CardDescription className="mt-1">{description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
