/** Shared easing/duration so every motion primitive feels like one system. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DURATION = {
  fast: 0.3,
  base: 0.6,
  slow: 0.9,
} as const;

export const VIEWPORT_ONCE = { once: true, margin: "-80px" } as const;
