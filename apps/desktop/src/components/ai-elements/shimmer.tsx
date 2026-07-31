import { cn } from "@/lib/utils";
import type { CSSProperties, ElementType } from "react";
import { memo, useMemo } from "react";

/**
 * A shimmering-text loader (the "Thinking…" effect) — a highlight sweeping
 * across the letters via `bg-clip-text`.
 *
 * Pure CSS on purpose: this used to pull in `motion` just to animate one
 * background-position, which dragged React-19 types into a React-18 app and
 * broke the typecheck on CI. A keyframe does the same job with no dependency.
 */

const KEYFRAME_ID = "otter-shimmer-keyframes";

/** Inject the sweep keyframe once, lazily (no-op outside the browser). */
function ensureKeyframes(): void {
  if (typeof document === "undefined" || document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAME_ID;
  style.textContent =
    "@keyframes otter-shimmer { from { background-position: 100% center } to { background-position: 0% center } }";
  document.head.appendChild(style);
}

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "span",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  ensureKeyframes();

  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread]);

  return (
    <Component
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
          animation: `otter-shimmer ${duration}s linear infinite`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
