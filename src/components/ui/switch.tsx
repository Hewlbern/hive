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
      data-testid="share-toggle"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group inline-flex items-center gap-3 rounded-full px-1 py-1 transition",
        className,
      )}
    >
      <span
        className={cn(
          "relative h-8 w-14 rounded-full transition",
          checked ? "bg-violet" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 h-6 w-6 rounded-full bg-white transition-transform",
            checked && "translate-x-6",
          )}
        />
      </span>
      {label ? <span className="text-[15px] font-semibold">{label}</span> : null}
    </button>
  );
}
