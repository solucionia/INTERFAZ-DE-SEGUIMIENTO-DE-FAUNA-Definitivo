import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Study } from "@shared/schema";
import { BarChart3 } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function SelectStudyVisualize() {
  const [, setLocation] = useLocation();
  const [selectedStudyId, setSelectedStudyId] = useState<string>("");

  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const handleOpen = () => {
    if (selectedStudyId) {
      setLocation(`/study/${selectedStudyId}/visualize`);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <Breadcrumbs items={[{ label: "Visualizador de datos" }]} />

      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          Visualizador de datos
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Seleccione un estudio para abrir su visualizador de datos.
      </p>

      {isLoading ? (
        <Skeleton className="h-10 w-full max-w-md" />
      ) : !studies || studies.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-studies">
          No hay estudios disponibles.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Estudio</label>
            <Select value={selectedStudyId} onValueChange={setSelectedStudyId}>
              <SelectTrigger className="w-64" data-testid="select-study">
                <SelectValue placeholder="Seleccionar estudio" />
              </SelectTrigger>
              <SelectContent>
                {studies.map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`select-study-${s.id}`}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleOpen}
            disabled={!selectedStudyId}
            data-testid="button-open-visualizer"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Abrir visualizador
          </Button>
        </div>
      )}
    </div>
  );
}
