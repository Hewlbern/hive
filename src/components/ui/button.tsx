import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "line" | "danger";
  size?: "md" | "sm" | "lg";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" && "h-10 px-4 text-sm",
        size === "md" && "h-12 px-5 text-[15px]",
        size === "lg" && "h-14 px-7 text-base",
        variant === "primary" && "bg-violet text-white hover:bg-violet-soft",
        variant === "ghost" && "bg-transparent text-ink hover:bg-white/5",
        variant === "line" && "border border-line bg-transparent text-ink hover:border-violet/50",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
      {...props}
    />
  );
}
