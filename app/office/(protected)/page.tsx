import { HeadquartersLoader } from "@/components/ai-office/headquarters/headquarters-loader";

export const metadata = { title: "3D Headquarters" };

/**
 * `/office` is the approved 3D Headquarters. The previous dashboard-style
 * Office lives on unchanged at `/office/classic` as the troubleshooting and
 * fallback surface. Both render inside the same protected layout and read the
 * same mode-aware state layer, so there is exactly one execution/state system.
 */
export default function OfficeHomePage() {
  return <HeadquartersLoader />;
}
