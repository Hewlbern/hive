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
        "inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight transition disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-5 text-[15px]",
        size === "lg" && "h-13 px-6 text-base min-h-12",
        variant === "primary" && "bg-honey text-[#1a1204] hover:bg-[#ffc35a]",
        variant === "ghost" && "bg-transparent text-ink hover:bg-white/5",
        variant === "line" && "border border-line bg-transparent text-ink hover:border-honey/50",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
      {...props}
    />
  );
}
