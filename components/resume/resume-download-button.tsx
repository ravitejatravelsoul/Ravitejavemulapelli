import { Download, FileClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MagneticButton } from "@/components/motion/magnetic-button";
import { getResume } from "@/lib/data";
import { isPublicAssetAvailable } from "@/lib/asset-availability";
import { cn } from "@/lib/utils";

interface ResumeDownloadButtonProps {
  label?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  className?: string;
  magnetic?: boolean;
}

/**
 * Single source of truth for the "download resume" affordance, used in the
 * Hero, Footer, and Resume page. Checks whether the PDF actually exists on
 * disk (see `isPublicAssetAvailable`) and renders a real working download
 * link if so, or a disabled "coming soon" button in the exact same slot if
 * not — never a link that 404s. Once the PDF is added to
 * `public/resume/`, every instance of this component starts working with no
 * code change.
 */
export async function ResumeDownloadButton({
  label = "Download Resume",
  size = "lg",
  variant = "outline",
  className,
  magnetic = true,
}: ResumeDownloadButtonProps) {
  const resume = await getResume();
  const available = isPublicAssetAvailable(resume.downloadUrl);

  if (!available) {
    return (
      <Button
        size={size}
        variant={variant}
        disabled
        title="Resume PDF coming soon"
        className={cn(className)}
      >
        <FileClock className="size-4" /> Resume Coming Soon
      </Button>
    );
  }

  const button = (
    <Button asChild size={size} variant={variant} className={className}>
      <a href={resume.downloadUrl} download>
        <Download className="size-4" /> {label}
      </a>
    </Button>
  );

  return magnetic ? <MagneticButton>{button}</MagneticButton> : button;
}
