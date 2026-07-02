import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// Identificador del sensor de acelerómetro en Movebank.
export const SENSOR_ACC = 2365683;
// Límite de puntos renderizados por gráfica (downsampling para rendimiento).
export const MAX_CHART_POINTS = 2000;

// Colores fijos de los tres ejes, compartidos por toda la plataforma para
// mantener la consistencia visual entre vistas (X azul, Y rojo, Z amarillo).
export const ACC_AXIS_COLORS = { x: "#3B82F6", y: "#EF4444", z: "#EAB308" } as const;

export interface AccPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  animal?: string;
}

// Parsea la respuesta cruda del endpoint /events (sensor acelerómetro).
// Soporta tanto muestras individuales (acceleration_x/y/z) como ráfagas
// crudas (accelerations_raw / eobs_accelerations_raw) expandidas a 10 ms/muestra.
export function parseAccEvents(animal: string, rows: Record<string, string>[]): AccPoint[] {
  const points: AccPoint[] = [];
  for (const r of rows) {
    const rawAxes = r.accelerations_raw || r.eobs_accelerations_raw || "";
    const ts = new Date(r.timestamp).getTime();
    if (isNaN(ts)) continue;
    if (rawAxes) {
      const vals = rawAxes.split(/\s+/).map(Number);
      for (let i = 0; i + 2 < vals.length; i += 3) {
        if (!isNaN(vals[i]) && !isNaN(vals[i + 1]) && !isNaN(vals[i + 2])) {
          points.push({ timestamp: ts + i * 10, x: vals[i], y: vals[i + 1], z: vals[i + 2], animal });
        }
      }
    } else {
      points.push({
        timestamp: ts,
        x: parseFloat(r.acceleration_x || "0"),
        y: parseFloat(r.acceleration_y || "0"),
        z: parseFloat(r.acceleration_z || "0"),
        animal,
      });
    }
  }
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

export function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}

export function formatAccTimestamp(ts: number): string {
  try {
    return format(new Date(ts), "dd/MM HH:mm:ss", { locale: es });
  } catch {
    return String(ts);
  }
}

interface AccelerometerChartProps {
  data: AccPoint[];
  // Habilita el click sobre la gráfica (para resaltar el punto en un mapa) y
  // el marcador del punto resaltado. Por defecto la gráfica es de solo lectura.
  interactive?: boolean;
  onPointClick?: (e: any) => void;
  highlightTimestamp?: number | null;
}

// Gráfica reutilizable del acelerómetro (ejes X/Y/Z) usada en toda la
// plataforma. Mantiene colores, formato de ejes y tooltip consistentes.
export function AccelerometerChart({
  data,
  interactive = false,
  onPointClick,
  highlightTimestamp = null,
}: AccelerometerChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
        onClick={interactive ? onPointClick : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatAccTimestamp}
          type="number"
          domain={["dataMin", "dataMax"]}
          fontSize={10}
          tick={{ fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} width={40} />
        <RechartsTooltip
          labelFormatter={(ts) => formatAccTimestamp(ts as number)}
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: "12px",
            color: "hsl(var(--foreground))",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "11px" }} />
        <Line type="monotone" dataKey="x" stroke={ACC_AXIS_COLORS.x} name="Eje X" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line type="monotone" dataKey="y" stroke={ACC_AXIS_COLORS.y} name="Eje Y" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line type="monotone" dataKey="z" stroke={ACC_AXIS_COLORS.z} name="Eje Z" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        {interactive && highlightTimestamp !== null && data.length > 0 && (() => {
          let nearest = data[0];
          let minDiff = Math.abs(nearest.timestamp - highlightTimestamp);
          for (const d of data) {
            const diff = Math.abs(d.timestamp - highlightTimestamp);
            if (diff < minDiff) { minDiff = diff; nearest = d; }
          }
          return <ReferenceDot x={nearest.timestamp} y={nearest.x} r={6} fill="#ef4444" stroke="white" strokeWidth={2} />;
        })()}
      </LineChart>
    </ResponsiveContainer>
  );
}
