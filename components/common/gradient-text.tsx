import { cn } from "@/lib/utils";

export function GradientText({
  className,
  children,
  as: Tag = "span",
}: {
  className?: string;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  return <Tag className={cn("text-gradient", className)}>{children}</Tag>;
}
