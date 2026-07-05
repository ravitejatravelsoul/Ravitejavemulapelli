import { cn } from "@/lib/utils";
import { Container } from "@/components/common/container";

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  containerClassName?: string;
  glow?: boolean;
}

export function Section({
  className,
  containerClassName,
  glow,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn("relative py-24 md:py-32", glow && "glow-field", className)}
      {...props}
    >
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}
