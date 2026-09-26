import { redirect } from "next/navigation";

/** Legacy URL of the 3D Headquarters; it is now the primary Office at `/office`. */
export default async function LegacyHeadquartersRedirect({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  redirect(project ? `/office?project=${encodeURIComponent(project)}` : "/office");
}
