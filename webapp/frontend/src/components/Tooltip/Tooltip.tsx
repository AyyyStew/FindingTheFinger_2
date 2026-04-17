import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

type TooltipPlacement = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TooltipChildProps>;
  placement?: TooltipPlacement;
  align?: TooltipAlign;
  disabled?: boolean;
  className?: string;
}

interface TooltipChildProps {
  "aria-describedby"?: string;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: TooltipPlacement;
}

const OFFSET = 8;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolvePosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  preferredPlacement: TooltipPlacement,
  align: TooltipAlign,
): TooltipPosition {
  const fitsBelow =
    triggerRect.bottom + OFFSET + tooltipRect.height <=
    window.innerHeight - VIEWPORT_PADDING;
  const fitsAbove =
    triggerRect.top - OFFSET - tooltipRect.height >= VIEWPORT_PADDING;
  const fitsRight =
    triggerRect.right + OFFSET + tooltipRect.width <=
    window.innerWidth - VIEWPORT_PADDING;
  const fitsLeft =
    triggerRect.left - OFFSET - tooltipRect.width >= VIEWPORT_PADDING;

  let placement = preferredPlacement;
  if (placement === "bottom" && !fitsBelow && fitsAbove) placement = "top";
  if (placement === "top" && !fitsAbove && fitsBelow) placement = "bottom";
  if (placement === "right" && !fitsRight && fitsLeft) placement = "left";
  if (placement === "left" && !fitsLeft && fitsRight) placement = "right";

  const centerX = triggerRect.left + triggerRect.width / 2;
  const centerY = triggerRect.top + triggerRect.height / 2;

  let left = centerX - tooltipRect.width / 2;
  let top = triggerRect.bottom + OFFSET;

  if (placement === "top") top = triggerRect.top - tooltipRect.height - OFFSET;
  if (placement === "right") {
    left = triggerRect.right + OFFSET;
    top = centerY - tooltipRect.height / 2;
  }
  if (placement === "left") {
    left = triggerRect.left - tooltipRect.width - OFFSET;
    top = centerY - tooltipRect.height / 2;
  }

  if (placement === "top" || placement === "bottom") {
    if (align === "start") left = triggerRect.left;
    if (align === "end") left = triggerRect.right - tooltipRect.width;
  } else {
    if (align === "start") top = triggerRect.top;
    if (align === "end") top = triggerRect.bottom - tooltipRect.height;
  }

  return {
    left: clamp(left, VIEWPORT_PADDING, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING),
    top: clamp(top, VIEWPORT_PADDING, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING),
    placement,
  };
}

export function Tooltip({
  content,
  children,
  placement = "bottom",
  align = "center",
  disabled = false,
  className,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || disabled) return;

    const updatePosition = () => {
      const triggerEl = triggerRef.current;
      const tooltipEl = tooltipRef.current;
      if (!triggerEl || !tooltipEl) return;
      setPosition(
        resolvePosition(
          triggerEl.getBoundingClientRect(),
          tooltipEl.getBoundingClientRect(),
          placement,
          align,
        ),
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, disabled, open, placement]);

  if (disabled || !content || !isValidElement(children)) return children;

  const describedBy = [
    children.props["aria-describedby"],
    open ? id : null,
  ]
    .filter(Boolean)
    .join(" ");
  const child = cloneElement(children, {
    "aria-describedby": describedBy || undefined,
  });

  return (
    <>
      <span
        ref={triggerRef}
        className={`${styles.trigger} ${className ?? ""}`}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        {child}
      </span>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className={styles.tooltip}
            data-placement={position?.placement ?? placement}
            style={
              position
                ? { left: position.left, top: position.top }
                : { left: -9999, top: -9999 }
            }
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
