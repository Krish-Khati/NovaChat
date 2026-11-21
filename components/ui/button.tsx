"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui-style Button (hand-rolled to match the project's token set).
 * Variants cover everything the shell needs — no extra deps.
 */

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover shadow-lift",
  secondary:
    "bg-muted text-foreground hover:bg-border/70 border border-transparent",
  ghost: "text-foreground hover:bg-muted",
  outline:
    "border border-border bg-transparent hover:bg-muted text-foreground",
  danger:
    "bg-transparent text-[var(--danger,#e5484d)] hover:bg-[color-mix(in_srgb,#e5484d_12%,transparent)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-base gap-2 rounded-2xl",
  icon: "h-9 w-9 rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50 select-none",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
