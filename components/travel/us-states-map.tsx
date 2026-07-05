"use client";

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const GEO_URL = "/data/us-states-10m.json";

/**
 * Interactive US states map — the primary travel visual, since travel has
 * mostly been domestic. Visited states (from `travel.json`'s flat `states`
 * list — the data model wasn't restructured for this) glow; everything else
 * stays quiet. `geoAlbersUsa` is the standard d3 projection for this exact
 * job: it insets Alaska/Hawaii into the frame instead of leaving them at
 * their true, chart-breaking coordinates.
 */
export function UsStatesMap({ states }: { states: string[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const visitedSet = useMemo(
    () => new Set(states.map((state) => state.toLowerCase())),
    [states],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-secondary/20 p-4 sm:p-6">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const name = geo.properties.name as string;
              const isVisited = visitedSet.has(name.toLowerCase());

              const geography = (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onMouseEnter={() => setHovered(name)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    default: {
                      fill: isVisited ? "var(--primary)" : "var(--muted)",
                      fillOpacity: isVisited ? 0.85 : 0.3,
                      stroke: "var(--border)",
                      strokeWidth: 0.6,
                      outline: "none",
                      filter: isVisited
                        ? "drop-shadow(0 0 6px color-mix(in oklch, var(--primary) 60%, transparent))"
                        : "none",
                      transition: "fill-opacity 0.25s ease, filter 0.25s ease",
                    },
                    hover: {
                      fill: isVisited ? "var(--primary)" : "var(--muted-foreground)",
                      fillOpacity: isVisited ? 1 : 0.5,
                      stroke: "var(--border)",
                      strokeWidth: 0.6,
                      outline: "none",
                    },
                    pressed: {
                      fill: "var(--primary)",
                      outline: "none",
                    },
                  }}
                />
              );

              return (
                <Tooltip key={geo.rsmKey}>
                  <TooltipTrigger asChild>{geography}</TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {isVisited ? "Visited" : "Not yet"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })
          }
        </Geographies>
      </ComposableMap>

      <div className="mt-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" style={{ boxShadow: "0 0 6px var(--primary)" }} />
          Visited
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted" />
          Not yet
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {hovered}
      </span>
    </div>
  );
}
