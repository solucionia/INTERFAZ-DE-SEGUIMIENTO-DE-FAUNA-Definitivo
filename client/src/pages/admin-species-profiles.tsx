import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { SpeciesProfile, EventThresholds } from "@shared/schema";
import { DEFAULT_THRESHOLDS, normalizeThresholds, EVENT_LABELS, EVENT_COLORS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Loader2, Dna, AlertTriangle, Zap, Utensils, Bird, Skull } from "lucide-react";

const EVENT_ICONS: Record<string, any> = {
  mortality: Skull,
  detachment: Zap,
  fight: AlertTriangle,
  feeding: Utensils,
  incubation: Bird,
};

interface ThresholdFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  testId: string;
}

function ThresholdField({ label, value, onChange, unit, testId }: ThresholdFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground min-w-[140px]">{label}</Label>
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-24"
        data-testid={testId}
      />
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
    </div>
  );
}

export default function AdminSpeciesProfiles() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editProfile, setEditProfile] = useState<SpeciesProfile | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<SpeciesProfile | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [thresholds, setThresholds] = useState<EventThresholds>({ ...DEFAULT_THRESHOLDS });

  const { data: profiles, isLoading } = useQuery<SpeciesProfile[]>({
    queryKey: ["/api/species-profiles"],
  });

  const openCreate = () => {
    setEditProfile(null);
    setName("");
    setDescription("");
    setThresholds({ ...DEFAULT_THRESHOLDS });
    setShowForm(true);
  };

  const openEdit = (profile: SpeciesProfile) => {
    setEditProfile(profile);
    setName(profile.name);
    setDescription(profile.description || "");
    setThresholds(normalizeThresholds(profile.thresholds));
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name, description: description || null, thresholds };
      if (editProfile) {
        await apiRequest("PATCH", `/api/species-profiles/${editProfile.id}`, body);
      } else {
        await apiRequest("POST", "/api/species-profiles", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/species-profiles"] });
      setShowForm(false);
      toast({ title: editProfile ? "Perfil actualizado" : "Perfil creado" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/species-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/species-profiles"] });
      setDeleteProfile(null);
      toast({ title: "Perfil eliminado" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const updateThreshold = <K extends keyof EventThresholds>(
    category: K,
    field: keyof EventThresholds[K],
    value: number | boolean
  ) => {
    setThresholds((prev) => ({
      ...prev,
      [category]: { ...prev[category], [field]: value },
    }));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-profiles-title">
            Perfiles de especie
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configura umbrales de deteccion de eventos por especie
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-profile">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo perfil
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          ) : profiles && profiles.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Descripcion</TableHead>
                    <TableHead>Eventos configurados</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile) => (
                    <TableRow key={profile.id} data-testid={`row-profile-${profile.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Dna className="w-4 h-4 text-primary" />
                          {profile.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {profile.description || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {Object.keys(EVENT_LABELS).map((type) => {
                            const t = (profile.thresholds as EventThresholds)?.[type as keyof EventThresholds];
                            const isEnabled = t && (t as any).enabled !== false;
                            return (
                              <Badge
                                key={type}
                                variant="outline"
                                className={`text-xs ${!isEnabled ? "opacity-30 line-through" : ""}`}
                                style={{ borderColor: EVENT_COLORS[type as keyof typeof EVENT_COLORS], color: EVENT_COLORS[type as keyof typeof EVENT_COLORS] }}
                              >
                                {EVENT_LABELS[type as keyof typeof EVENT_LABELS].split("/")[0].trim()}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(profile)} data-testid={`button-edit-profile-${profile.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteProfile(profile)} data-testid={`button-delete-profile-${profile.id}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <Dna className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay perfiles de especie</p>
              <p className="text-xs text-muted-foreground mt-1">Crea un perfil para configurar los umbrales de deteccion</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProfile ? "Editar perfil" : "Nuevo perfil de especie"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del perfil</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Aguila real"
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Descripcion (opcional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej: Umbrales para aves rapaces de gran tamano"
                data-testid="input-profile-description"
              />
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3">Umbrales de deteccion de eventos</h3>
              <Accordion type="multiple" className="space-y-2" defaultValue={["mortality", "detachment", "fight", "feeding", "incubation"]}>
                <AccordionItem value="mortality" className="border rounded-md px-3">
                  <AccordionTrigger className="py-2">
                    <div className="flex items-center gap-2">
                      <Skull className="w-4 h-4" style={{ color: EVENT_COLORS.mortality }} />
                      <span className="text-sm font-medium">Mortalidad</span>
                      <Badge variant="outline" className="text-xs" style={{ borderColor: EVENT_COLORS.mortality, color: EVENT_COLORS.mortality }}>Critica</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Acelerometro estacionario sin variacion significativa durante un periodo prolongado</p>
                      <Switch checked={thresholds.mortality.enabled !== false} onCheckedChange={(v) => updateThreshold("mortality", "enabled", v)} data-testid="switch-mortality-enabled" />
                    </div>
                    <ThresholdField label="Variacion maxima" value={thresholds.mortality.stationaryVariance} onChange={(v) => updateThreshold("mortality", "stationaryVariance", v)} testId="input-mortality-variance" />
                    <ThresholdField label="Duracion minima" value={thresholds.mortality.durationHours} onChange={(v) => updateThreshold("mortality", "durationHours", v)} unit="horas" testId="input-mortality-duration" />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="detachment" className="border rounded-md px-3">
                  <AccordionTrigger className="py-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4" style={{ color: EVENT_COLORS.detachment }} />
                      <span className="text-sm font-medium">Desprendimiento del emisor</span>
                      <Badge variant="outline" className="text-xs" style={{ borderColor: EVENT_COLORS.detachment, color: EVENT_COLORS.detachment }}>Warning</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Eje X fuera de rango durante multiples posiciones consecutivas</p>
                      <Switch checked={thresholds.detachment.enabled !== false} onCheckedChange={(v) => updateThreshold("detachment", "enabled", v)} data-testid="switch-detachment-enabled" />
                    </div>
                    <ThresholdField label="Umbral X superior" value={thresholds.detachment.xThresholdHigh} onChange={(v) => updateThreshold("detachment", "xThresholdHigh", v)} testId="input-detach-high" />
                    <ThresholdField label="Umbral X inferior" value={thresholds.detachment.xThresholdLow} onChange={(v) => updateThreshold("detachment", "xThresholdLow", v)} testId="input-detach-low" />
                    <ThresholdField label="Min. posiciones" value={thresholds.detachment.minPositions} onChange={(v) => updateThreshold("detachment", "minPositions", v)} testId="input-detach-min" />
                    <ThresholdField label="Ventana" value={thresholds.detachment.windowSize} onChange={(v) => updateThreshold("detachment", "windowSize", v)} unit="posiciones" testId="input-detach-window" />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="fight" className="border rounded-md px-3">
                  <AccordionTrigger className="py-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: EVENT_COLORS.fight }} />
                      <span className="text-sm font-medium">Pelea / Depredacion</span>
                      <Badge variant="outline" className="text-xs" style={{ borderColor: EVENT_COLORS.fight, color: EVENT_COLORS.fight }}>Warning</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Eje Z con valores negativos extremos alternando con valores positivos</p>
                      <Switch checked={thresholds.fight.enabled !== false} onCheckedChange={(v) => updateThreshold("fight", "enabled", v)} data-testid="switch-fight-enabled" />
                    </div>
                    <ThresholdField label="Umbral Z negativo" value={thresholds.fight.zThreshold} onChange={(v) => updateThreshold("fight", "zThreshold", v)} testId="input-fight-z" />
                    <ThresholdField label="Min. ocurrencias" value={thresholds.fight.minOccurrences} onChange={(v) => updateThreshold("fight", "minOccurrences", v)} testId="input-fight-occur" />
                    <ThresholdField label="Ventana" value={thresholds.fight.windowMinutes} onChange={(v) => updateThreshold("fight", "windowMinutes", v)} unit="minutos" testId="input-fight-window" />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="feeding" className="border rounded-md px-3">
                  <AccordionTrigger className="py-2">
                    <div className="flex items-center gap-2">
                      <Utensils className="w-4 h-4" style={{ color: EVENT_COLORS.feeding }} />
                      <span className="text-sm font-medium">Alimentacion</span>
                      <Badge variant="outline" className="text-xs" style={{ borderColor: EVENT_COLORS.feeding, color: EVENT_COLORS.feeding }}>Informativa</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Eje Y con valores positivos elevados en un periodo corto</p>
                      <Switch checked={thresholds.feeding.enabled !== false} onCheckedChange={(v) => updateThreshold("feeding", "enabled", v)} data-testid="switch-feeding-enabled" />
                    </div>
                    <ThresholdField label="Umbral Y positivo" value={thresholds.feeding.yThreshold} onChange={(v) => updateThreshold("feeding", "yThreshold", v)} testId="input-feed-y" />
                    <ThresholdField label="Min. ocurrencias" value={thresholds.feeding.minOccurrences} onChange={(v) => updateThreshold("feeding", "minOccurrences", v)} testId="input-feed-occur" />
                    <ThresholdField label="Ventana" value={thresholds.feeding.windowMinutes} onChange={(v) => updateThreshold("feeding", "windowMinutes", v)} unit="minutos" testId="input-feed-window" />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="incubation" className="border rounded-md px-3">
                  <AccordionTrigger className="py-2">
                    <div className="flex items-center gap-2">
                      <Bird className="w-4 h-4" style={{ color: EVENT_COLORS.incubation }} />
                      <span className="text-sm font-medium">Incubacion / Vuelo</span>
                      <Badge variant="outline" className="text-xs" style={{ borderColor: EVENT_COLORS.incubation, color: EVENT_COLORS.incubation }}>Informativa</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Eje Y contenido en rango con alternancia de valores (no estacionario)</p>
                      <Switch checked={thresholds.incubation.enabled !== false} onCheckedChange={(v) => updateThreshold("incubation", "enabled", v)} data-testid="switch-incubation-enabled" />
                    </div>
                    <ThresholdField label="Rango Y inferior" value={thresholds.incubation.yRangeLow} onChange={(v) => updateThreshold("incubation", "yRangeLow", v)} testId="input-incub-low" />
                    <ThresholdField label="Rango Y superior" value={thresholds.incubation.yRangeHigh} onChange={(v) => updateThreshold("incubation", "yRangeHigh", v)} testId="input-incub-high" />
                    <ThresholdField label="Desv. estandar min." value={thresholds.incubation.minStdDev} onChange={(v) => updateThreshold("incubation", "minStdDev", v)} testId="input-incub-stddev" />
                    <ThresholdField label="Ventana" value={thresholds.incubation.windowMinutes} onChange={(v) => updateThreshold("incubation", "windowMinutes", v)} unit="minutos" testId="input-incub-window" />
                    <ThresholdField label="Cambios de signo min." value={thresholds.incubation.minSignChanges} onChange={(v) => updateThreshold("incubation", "minSignChanges", v)} testId="input-incub-signs" />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name.trim()} data-testid="button-save-profile">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editProfile ? "Guardar cambios" : "Crear perfil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteProfile} onOpenChange={(open) => !open && setDeleteProfile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar perfil</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estas seguro de eliminar el perfil "{deleteProfile?.name}"? Los estudios que lo usen dejaran de tener un perfil asignado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteProfile && deleteMutation.mutate(deleteProfile.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-profile"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
