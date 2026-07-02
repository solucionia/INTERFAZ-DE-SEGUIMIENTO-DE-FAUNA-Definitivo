import { useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";

export type QuickRange = "1h" | "6h" | "24h" | "7d" | "14d" | "30d" | "90d" | "1a" | "3a" | "todo";

const RANGE_LABELS: Record<QuickRange, string> = {
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
  "7d": "7d",
  "14d": "14d",
  "30d": "30d",
  "90d": "90d",
  "1a": "1a",
  "3a": "3a",
  "todo": "Todo",
};

const DEFAULT_RANGE_KEYS: QuickRange[] = ["1h", "6h", "24h", "7d", "30d", "90d", "1a", "3a", "todo"];

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
    case "14d":
      start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
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
    case "3a":
      start = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
      break;
    case "todo":
      // Fallback cuando no se puede resolver el primer dato real del animal
      // (p. ej. sin animal seleccionado o comparación multi-estudio).
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
  ranges?: QuickRange[];
  // Cuando se proporcionan, "Todo" arranca desde el primer dato real de los
  // animales indicados (y termina en el último), en lugar de un rango fijo.
  studyId?: string;
  individuals?: string[];
}

export function QuickDateRange({
  activeRange,
  onRangeSelect,
  autoLoad,
  onAutoLoadChange,
  className = "",
  ranges,
  studyId,
  individuals,
}: QuickDateRangeProps) {
  const rangeKeys = ranges ?? DEFAULT_RANGE_KEYS;
  const [resolvingTodo, setResolvingTodo] = useState(false);
  // Contador para descartar respuestas obsoletas de "Todo": si el usuario pulsa
  // otro rango (o cambia de animal) mientras la petición está en vuelo, la
  // respuesta tardía no debe sobreescribir la selección más reciente.
  const todoReqId = useRef(0);

  const handleClick = useCallback(
    async (range: QuickRange) => {
      // Cualquier clic invalida una resolución de "Todo" en curso.
      todoReqId.current++;
      const myReqId = todoReqId.current;

      if (range === "todo" && studyId && individuals && individuals.length > 0) {
        setResolvingTodo(true);
        try {
          const params = new URLSearchParams({ individuals: individuals.join(",") });
          const res = await fetch(`/api/studies/${studyId}/data-range?${params.toString()}`, {
            credentials: "include",
          });
          if (res.ok) {
            const data: { min: number | null; max: number | null } = await res.json();
            // Descartamos si ya hubo una interacción más reciente.
            if (myReqId !== todoReqId.current) return;
            if (data.min != null) {
              const startStr = format(new Date(data.min), "yyyy-MM-dd");
              const endStr = format(new Date(data.max ?? Date.now()), "yyyy-MM-dd");
              onRangeSelect(range, startStr, endStr);
              return;
            }
          }
        } catch {
          // Ignoramos el error y caemos al rango fijo de respaldo.
        } finally {
          if (myReqId === todoReqId.current) setResolvingTodo(false);
        }
        // Fallback solo si esta petición sigue siendo la vigente.
        if (myReqId !== todoReqId.current) return;
      }
      const { start, end } = computeDateRange(range);
      onRangeSelect(range, start, end);
    },
    [onRangeSelect, studyId, individuals]
  );

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {rangeKeys.map((key) => (
        <Badge
          key={key}
          variant={activeRange === key ? "default" : "outline"}
          className={`cursor-pointer select-none text-xs toggle-elevate ${activeRange === key ? "toggle-elevated" : ""} ${key === "todo" && resolvingTodo ? "opacity-50 pointer-events-none" : ""}`}
          onClick={() => handleClick(key)}
          data-testid={`badge-range-${key}`}
        >
          {RANGE_LABELS[key]}
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
