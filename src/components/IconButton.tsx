import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
}

export function IconButton({ label, children, active, danger, className = "", onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, onMouseDown, onClick, ...props }: IconButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const tooltipId = useId();
  const [tooltip, setTooltip] = useState<{ left: number; top: number; below: boolean; align: "start" | "center" | "end" }>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = rect.top < 48;
      const center = rect.left + rect.width / 2;
      const align = center > window.innerWidth - 96 ? "end" : center < 96 ? "start" : "center";
      const left = align === "end" ? Math.min(window.innerWidth - 8, rect.right) : align === "start" ? Math.max(8, rect.left) : center;
      setTooltip({ left, top: below ? rect.bottom + 7 : rect.top - 7, below, align });
    }, 80);
  };
  const hide = () => { window.clearTimeout(timer.current); setTooltip(undefined); };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-button ${active ? "is-active" : ""} ${danger ? "is-danger" : ""} ${className}`}
        aria-label={label}
        aria-describedby={tooltip ? tooltipId : undefined}
        data-tooltip={label}
        onPointerEnter={(event) => { show(); onPointerEnter?.(event); }}
        onPointerLeave={(event) => { hide(); onPointerLeave?.(event); }}
        onPointerDown={(event) => { event.stopPropagation(); onPointerDown?.(event); }}
        onFocus={(event) => { show(); onFocus?.(event); }}
        onBlur={(event) => { hide(); onBlur?.(event); }}
        onMouseDown={(event) => { event.stopPropagation(); onMouseDown?.(event); }}
        onClick={(event) => { hide(); onClick?.(event); }}
        {...props}
      >
        {children}
      </button>
      {tooltip ? createPortal(
        <span id={tooltipId} className={`icon-tooltip ${tooltip.below ? "is-below" : ""} is-align-${tooltip.align}`} style={{ left: tooltip.left, top: tooltip.top }} role="tooltip">{label}</span>,
        document.querySelector(".app-shell") ?? document.body
      ) : null}
    </>
  );
}
