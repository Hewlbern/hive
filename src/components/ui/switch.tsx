import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group inline-flex items-center gap-3 rounded-full border px-3 py-2 transition",
        checked ? "border-honey/60 bg-honey/10" : "border-line bg-black/30",
        className,
      )}
    >
      <span
        className={cn(
          "relative h-7 w-12 rounded-full transition",
          checked ? "bg-honey" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-[#1a1204] transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
      {label ? <span className="text-sm font-medium">{label}</span> : null}
    </button>
  );
}
