"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The selected agent lives in the URL (`?agent=<roleId>`, alongside the
 * existing `?project=`) rather than component state, so a direct link
 * works, a refresh preserves the open Agent Workspace, and browser
 * back/forward closes/reopens it naturally (Section 24). Every place that
 * can open or close the workspace (office hotspots, the mobile agent
 * list, the workspace's own close button) shares this one hook so they
 * can never drift into separate, conflicting selection state.
 */
export function useAgentSelection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedRoleId = searchParams.get("agent");

  const selectRole = useCallback(
    (roleId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("agent", roleId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("agent");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return { selectedRoleId, selectRole, clearSelection };
}
