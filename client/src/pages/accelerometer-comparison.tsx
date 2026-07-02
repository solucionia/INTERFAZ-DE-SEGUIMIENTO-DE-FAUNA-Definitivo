import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Individual } from "@shared/schema";
import { formatAnimalLabelById } from "@/lib/animal-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AnimalSearch } from "@/components/animal-search";
import { QuickDateRange, computeDateRange, type QuickRange } from "@/components/quick-date-range";
import {
  AccelerometerChart,
  parseAccEvents,
  downsample,
  SENSOR_ACC,
  MAX_CHART_POINTS,
  type AccPoint,
} from "@/components/accelerometer-chart";
import { Activity, Loader2, Play, AlertTriangle } from "lucide-react";

const MAX_ANIMALS = 10;

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(now) };
}

interface AnimalResult {
  localId: string;
  data: AccPoint[];
  loading: boolean;
  error: string | null;
}

export default function AccelerometerComparison() {
  const { data: individuals } = useQuery<(Individual & { studyName: string })[]>({
    queryKey: ["/api/individuals/all"],
  });

  const [selected, setSelected] = useState<string[]>([]);
  const initial = useMemo(() => defaultRange(), []);
  const [dateStart, setDateStart] = useState(initial.start);
  const [dateEnd, setDateEnd] = useState(initial.end);
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRange | null>("7d");

  const [results, setResults] = useState<AnimalResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Identificador de la carga en curso: descarta respuestas obsoletas si el
  // usuario vuelve a lanzar una comparación antes de que termine la anterior.
  const loadIdRef = useRef(0);

  // Búsqueda de metadatos por localIdentifier para etiquetas "Nombre (ID)".
  const individualByLocalId = useMemo(() => {
    const map = new Map<string, Individual>();
    for (const ind of individuals || []) {
      if (ind.localIdentifier) map.set(ind.localIdentifier, ind);
    }
    return map;
  }, [individuals]);

  // studyId por localIdentifier: necesario porque el endpoint de eventos exige
  // el estudio y los animales seleccionados pueden pertenecer a estudios distintos.
  const studyIdByLocalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ind of individuals || []) {
      if (ind.localIdentifier) map.set(ind.localIdentifier, ind.studyId);
    }
    return map;
  }, [individuals]);

  const handleSelectionChange = (sel: string[]) => {
    setSelected(sel.slice(0, MAX_ANIMALS));
  };

  const handleQuickRange = (range: QuickRange, start: string, end: string) => {
    setActiveQuickRange(range);
    setDateStart(start);
    setDateEnd(end);
  };

  const loadComparison = async () => {
    if (selected.length === 0) return;
    const tsStart = new Date(dateStart + "T00:00:00").getTime();
    const tsEnd = new Date(dateEnd + "T23:59:59").getTime();
    if (isNaN(tsStart) || isNaN(tsEnd) || tsStart >= tsEnd) return;

    const myLoadId = ++loadIdRef.current;
    setIsLoading(true);
    // Sembramos las tarjetas en estado "cargando" para feedback inmediato.
    setResults(selected.map((localId) => ({ localId, data: [], loading: true, error: null })));

    // Agrupamos por estudio para minimizar el número de peticiones (una por
    // estudio con todos sus animales), priorizando carga rápida.
    const byStudy = new Map<string, string[]>();
    for (const localId of selected) {
      const studyId = studyIdByLocalId.get(localId);
      if (!studyId) continue;
      if (!byStudy.has(studyId)) byStudy.set(studyId, []);
      byStudy.get(studyId)!.push(localId);
    }

    // Animales sin estudio resuelto (no debería ocurrir): marcamos error.
    const noStudy = selected.filter((id) => !studyIdByLocalId.get(id));

    await Promise.all(
      Array.from(byStudy.entries()).map(async ([studyId, animals]) => {
        const params = new URLSearchParams({
          individuals: animals.join(","),
          timestamp_start: String(tsStart),
          timestamp_end: String(tsEnd),
          sensor_type: String(SENSOR_ACC),
        });
        try {
          const res = await fetch(`/api/studies/${studyId}/events?${params.toString()}`, {
            credentials: "include",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = (await res.json()) as Record<string, Record<string, string>[]>;
          if (loadIdRef.current !== myLoadId) return;
          setResults((prev) =>
            prev.map((r) => {
              if (!animals.includes(r.localId)) return r;
              const parsed = downsample(parseAccEvents(r.localId, raw[r.localId] || []), MAX_CHART_POINTS);
              return { ...r, data: parsed, loading: false, error: null };
            })
          );
        } catch (err) {
          if (loadIdRef.current !== myLoadId) return;
          const message = err instanceof Error ? err.message : "Error al cargar datos";
          setResults((prev) =>
            prev.map((r) =>
              animals.includes(r.localId) ? { ...r, loading: false, error: message } : r
            )
          );
        }
      })
    );

    if (loadIdRef.current === myLoadId) {
      if (noStudy.length > 0) {
        setResults((prev) =>
          prev.map((r) =>
            noStudy.includes(r.localId)
              ? { ...r, loading: false, error: "No se pudo resolver el estudio del animal" }
              : r
          )
        );
      }
      setIsLoading(false);
    }
  };

  const rangeInvalid = useMemo(() => {
    const s = new Date(dateStart + "T00:00:00").getTime();
    const e = new Date(dateEnd + "T23:59:59").getTime();
    return isNaN(s) || isNaN(e) || s >= e;
  }, [dateStart, dateEnd]);

  const rangeLabel = `${dateStart} → ${dateEnd}`;

  return (
    <div className="p-6 space-y-6" data-testid="view-accelerometer-comparison">
      <div className="flex items-center gap-2">
        <Activity className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Comparador de acelerómetros</h1>
          <p className="text-sm text-muted-foreground">
            Compara los acelerómetros de hasta {MAX_ANIMALS} animales en el mismo rango de fechas.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selección</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Animales (máx. {MAX_ANIMALS})</Label>
              <span className="text-xs text-muted-foreground" data-testid="text-selected-count">
                {selected.length}/{MAX_ANIMALS} seleccionados
              </span>
            </div>
            <AnimalSearch
              individuals={individuals || []}
              selected={selected}
              onChange={handleSelectionChange}
              multiple
              placeholder="Buscar animal por nombre o ID..."
            />
            {selected.length >= MAX_ANIMALS && (
              <p className="text-xs text-amber-500">
                Has alcanzado el máximo de {MAX_ANIMALS} animales.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
              <Input
                type="date"
                value={dateStart}
                onChange={(e) => { setDateStart(e.target.value); setActiveQuickRange(null); }}
                className="h-9"
                data-testid="input-date-start"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fecha fin</Label>
              <Input
                type="date"
                value={dateEnd}
                onChange={(e) => { setDateEnd(e.target.value); setActiveQuickRange(null); }}
                className="h-9"
                data-testid="input-date-end"
              />
            </div>
          </div>

          <QuickDateRange
            activeRange={activeQuickRange}
            onRangeSelect={handleQuickRange}
            autoLoad={false}
            onAutoLoadChange={() => {}}
          />

          {rangeInvalid && (
            <p className="text-xs text-destructive" data-testid="text-range-invalid">
              La fecha de inicio debe ser anterior a la fecha de fin.
            </p>
          )}

          <Button
            onClick={loadComparison}
            disabled={selected.length === 0 || isLoading || rangeInvalid}
            data-testid="button-load-comparison"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Comparar acelerómetros
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-4" data-testid="list-acc-charts">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rango:</span>
            <Badge variant="outline" data-testid="badge-active-range">{rangeLabel}</Badge>
          </div>
          {results.map((r) => (
            <Card key={r.localId} data-testid={`card-acc-${r.localId}`}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span data-testid={`text-animal-${r.localId}`}>
                    {formatAnimalLabelById(r.localId, individualByLocalId)}
                  </span>
                  {!r.loading && !r.error && (
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      {r.data.length} puntos
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  {r.loading ? (
                    <div className="h-full flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : r.error ? (
                    <div className="h-full flex flex-col items-center justify-center gap-1 text-center">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      <p className="text-xs text-destructive">{r.error}</p>
                    </div>
                  ) : r.data.length > 0 ? (
                    <AccelerometerChart data={r.data} />
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-xs text-muted-foreground">
                        No hay datos de acelerómetro para este rango
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
