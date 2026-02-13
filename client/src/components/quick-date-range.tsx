import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";

export type QuickRange = "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1a" | "todo";

interface QuickRangeOption {
  key: QuickRange;
  label: string;
}

const RANGES: QuickRangeOption[] = [
  { key: "1h", label: "1h" },
  { key: "6h", label: "6h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "1a", label: "1a" },
  { key: "todo", label: "Todo" },
];

function computeDateRange(range: QuickRange): { start: string; end: string } {
  const now = new Date();
  const endStr = format(now, "yyyy-MM-dd");
  let start: Date;

  switch (range) {
    case "1h":
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "6h":
      start = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      break;
    case "24h":
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "1a":
      start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case "todo":
      start = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return { start: format(start, "yyyy-MM-dd"), end: endStr };
}

interface QuickDateRangeProps {
  activeRange: QuickRange | null;
  onRangeSelect: (range: QuickRange, start: string, end: string) => void;
  autoLoad: boolean;
  onAutoLoadChange: (value: boolean) => void;
  className?: string;
}

export function QuickDateRange({
  activeRange,
  onRangeSelect,
  autoLoad,
  onAutoLoadChange,
  className = "",
}: QuickDateRangeProps) {
  const handleClick = useCallback(
    (range: QuickRange) => {
      const { start, end } = computeDateRange(range);
      onRangeSelect(range, start, end);
    },
    [onRangeSelect]
  );

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {RANGES.map((r) => (
        <Badge
          key={r.key}
          variant={activeRange === r.key ? "default" : "outline"}
          className={`cursor-pointer select-none text-xs toggle-elevate ${activeRange === r.key ? "toggle-elevated" : ""}`}
          onClick={() => handleClick(r.key)}
          data-testid={`badge-range-${r.key}`}
        >
          {r.label}
        </Badge>
      ))}
      <div className="flex items-center gap-1.5 ml-2">
        <Switch
          id="auto-load"
          checked={autoLoad}
          onCheckedChange={onAutoLoadChange}
          data-testid="switch-auto-load"
        />
        <Label htmlFor="auto-load" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
          Carga automatica
        </Label>
      </div>
    </div>
  );
}

export { computeDateRange };
