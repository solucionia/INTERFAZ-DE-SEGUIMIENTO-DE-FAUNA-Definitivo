import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Study, User, SpeciesProfile, OrnitelaDeviceStudy, UnassignedSftpFile } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Users, Loader2, Radio, Settings, X, FileWarning } from "lucide-react";

const createStudyFormSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  movebankStudyId: z.coerce.number().int().nonnegative().optional().or(z.literal(0)),
  movebankUsername: z.string().optional(),
  movebankPassword: z.string().optional(),
  alertEmail: z.string().email("Email inválido").or(z.literal("")).optional(),
  speciesProfileId: z.string().or(z.literal("")).optional(),
  ornitelaEnabled: z.boolean(),
  ornitelaPanelUrl: z.string().optional(),
  ornitelaUsername: z.string().optional(),
  ornitelaPassword: z.string().optional(),
  ornitelaSyncIntervalHours: z.coerce.number().optional(),
  active: z.boolean(),
});

const editStudyFormSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  movebankStudyId: z.coerce.number().int().nonnegative().optional().or(z.literal(0)),
  movebankUsername: z.string().optional(),
  movebankPassword: z.string().optional(),
  alertEmail: z.string().email("Email inválido").or(z.literal("")).optional(),
  speciesProfileId: z.string().or(z.literal("")).optional(),
  ornitelaEnabled: z.boolean(),
  ornitelaPanelUrl: z.string().optional(),
  ornitelaUsername: z.string().optional(),
  ornitelaPassword: z.string().optional(),
  ornitelaSyncIntervalHours: z.coerce.number().optional(),
  active: z.boolean(),
});

type StudyFormValues = z.infer<typeof createStudyFormSchema>;

export default function AdminStudies() {
  const { toast } = useToast();
  const [editStudy, setEditStudy] = useState<Study | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteStudy, setDeleteStudy] = useState<Study | null>(null);
  const [assignStudy, setAssignStudy] = useState<Study | null>(null);
  const [newDeviceIds, setNewDeviceIds] = useState<string[]>([]);
  const [formTab, setFormTab] = useState("general");

  const { data: studies, isLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: speciesProfiles } = useQuery<SpeciesProfile[]>({
    queryKey: ["/api/species-profiles"],
  });

  const { data: studyUsers, isLoading: assignLoading } = useQuery<string[]>({
    queryKey: ["/api/studies", assignStudy?.id, "users"],
    enabled: !!assignStudy,
  });

  const form = useForm<StudyFormValues>({
    resolver: zodResolver(editStudy ? editStudyFormSchema : createStudyFormSchema),
    defaultValues: {
      name: "",
      movebankStudyId: 0,
      movebankUsername: "",
      movebankPassword: "",
      alertEmail: "",
      speciesProfileId: "",
      ornitelaEnabled: false,
      ornitelaPanelUrl: "https://cpanel.glosendas.net",
      ornitelaUsername: "",
      ornitelaPassword: "",
      ornitelaSyncIntervalHours: 6,
      active: true,
    },
  });

  const openCreate = () => {
    setEditStudy(null);
    setNewDeviceIds([]);
    form.reset({
      name: "",
      movebankStudyId: 0,
      movebankUsername: "",
      movebankPassword: "",
      alertEmail: "",
      speciesProfileId: "",
      ornitelaEnabled: false,
      ornitelaPanelUrl: "https://cpanel.glosendas.net",
      ornitelaUsername: "",
      ornitelaPassword: "",
      ornitelaSyncIntervalHours: 6,
      active: true,
    });
    setFormTab("general");
    setShowForm(true);
  };

  const openEdit = (study: Study) => {
    setEditStudy(study);
    form.reset({
      name: study.name,
      movebankStudyId: study.movebankStudyId ?? 0,
      movebankUsername: "",
      movebankPassword: "",
      alertEmail: study.alertEmail || "",
      speciesProfileId: study.speciesProfileId || "",
      ornitelaEnabled: study.ornitelaEnabled ?? false,
      ornitelaPanelUrl: study.ornitelaPanelUrl || "https://cpanel.glosendas.net",
      ornitelaUsername: "",
      ornitelaPassword: "",
      ornitelaSyncIntervalHours: study.ornitelaSyncIntervalHours ?? 6,
      active: study.active,
    });
    setFormTab("general");
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: StudyFormValues) => {
      if (editStudy) {
        await apiRequest("PATCH", `/api/studies/${editStudy.id}`, values);
      } else {
        await apiRequest("POST", "/api/studies", { ...values, ornitelaDeviceIds: newDeviceIds });
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      setShowForm(false);
      if (!editStudy && variables.ornitelaEnabled && variables.ornitelaUsername && variables.ornitelaPassword) {
        toast({
          title: "Estudio creado",
          description: "Credenciales de Ornitela validadas. La primera sincronización ha comenzado en segundo plano.",
        });
      } else {
        toast({ title: editStudy ? "Estudio actualizado" : "Estudio creado" });
      }
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/studies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      setDeleteStudy(null);
      toast({ title: "Estudio eliminado" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ studyId, userId, assign }: { studyId: string; userId: string; assign: boolean }) => {
      if (assign) {
        await apiRequest("POST", `/api/studies/${studyId}/users`, { userId });
      } else {
        await apiRequest("DELETE", `/api/studies/${studyId}/users/${userId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies", assignStudy?.id, "users"] });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: StudyFormValues) => {
    saveMutation.mutate(values);
  };

  const FIELD_TAB_MAP: Record<string, string> = {
    name: "general",
    movebankStudyId: "general",
    alertEmail: "general",
    speciesProfileId: "general",
    active: "general",
    movebankUsername: "movebank",
    movebankPassword: "movebank",
    ornitelaEnabled: "ornitela",
    ornitelaPanelUrl: "ornitela",
    ornitelaUsername: "ornitela",
    ornitelaPassword: "ornitela",
    ornitelaSyncIntervalHours: "ornitela",
  };

  const onInvalid = (errors: Record<string, any>) => {
    const firstField = Object.keys(errors)[0];
    if (!firstField) return;
    const tab = FIELD_TAB_MAP[firstField] || "general";
    setFormTab(tab);
    setTimeout(() => form.setFocus(firstField as keyof StudyFormValues), 50);
    const message = errors[firstField]?.message || "Revisa los campos del formulario";
    toast({
      title: "Formulario incompleto",
      description: String(message),
      variant: "destructive",
    });
  };

  const normalUsers = allUsers?.filter((u) => u.role !== "superuser") || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-studies-title">
            Gestionar estudios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crea, edita y asigna estudios
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-study">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo estudio
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
          ) : studies && studies.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Movebank ID</TableHead>
                    <TableHead>Email alertas</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studies.map((study) => (
                    <TableRow key={study.id} data-testid={`row-study-${study.id}`}>
                      <TableCell className="font-medium">{study.name}</TableCell>
                      <TableCell className="text-muted-foreground">{study.movebankStudyId || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{study.alertEmail || "—"}</TableCell>
                      <TableCell>
                        {study.active ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="opacity-50">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setAssignStudy(study)}
                            data-testid={`button-assign-${study.id}`}
                          >
                            <Users className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(study)}
                            data-testid={`button-edit-${study.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteStudy(study)}
                            data-testid={`button-delete-${study.id}`}
                          >
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
              <Settings className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay estudios creados</p>
            </div>
          )}
        </CardContent>
      </Card>

      <UnassignedFilesCard studies={studies ?? []} />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editStudy ? "Editar estudio" : "Nuevo estudio"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-4">
              <Tabs value={formTab} onValueChange={setFormTab} className="w-full">
                <TabsList className="w-full grid grid-cols-3" data-testid="tabs-study-form">
                  <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
                  <TabsTrigger value="movebank" data-testid="tab-movebank">Movebank</TabsTrigger>
                  <TabsTrigger value="ornitela" data-testid="tab-ornitela">Ornitela</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 mt-4 max-h-[55vh] overflow-y-auto pr-1" data-testid="tab-content-general">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre del estudio</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: Águilas reales Patagonia" data-testid="input-study-name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="movebankStudyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Study ID de Movebank (opcional)</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="Ej: 12345678" data-testid="input-study-movebank-id" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="alertEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email de alertas (opcional)</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="alertas@ejemplo.com" data-testid="input-study-alert-email" {...field} />
                        </FormControl>
                        <FormDescription>Correo para recibir alertas de este estudio</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="speciesProfileId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Perfil de especie (opcional)</FormLabel>
                        <FormControl>
                          <Select value={field.value || ""} onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}>
                            <SelectTrigger data-testid="select-species-profile">
                              <SelectValue placeholder="Sin perfil asignado" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Sin perfil</SelectItem>
                              {speciesProfiles?.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>Determina los umbrales de deteccion de eventos</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="active"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel>Estudio activo</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-study-active" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="movebank" className="space-y-4 mt-4 max-h-[55vh] overflow-y-auto pr-1" data-testid="tab-content-movebank">
                  <p className="text-sm text-muted-foreground">Credenciales para sincronizar datos desde Movebank. Solo necesario si el estudio usa datos de Movebank.</p>
                  <FormField
                    control={form.control}
                    name="movebankUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Usuario de Movebank (opcional)</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            placeholder={editStudy ? "Dejar vacío para mantener actual" : "usuario@movebank"}
                            data-testid="input-study-mb-user"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{editStudy ? "Dejar vacío para mantener la credencial actual" : ""}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="movebankPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña de Movebank (opcional)</FormLabel>
                        <FormControl>
                          <PasswordInput
                            placeholder={editStudy ? "Dejar vacío para mantener actual" : "••••••"}
                            autoComplete="new-password"
                            data-testid="input-study-mb-pass"
                            toggleTestId="button-toggle-study-mb-pass"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{editStudy ? "Dejar vacío para mantener la credencial actual" : ""}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="ornitela" className="space-y-4 mt-4 max-h-[55vh] overflow-y-auto pr-1" data-testid="tab-content-ornitela">
                  <FormField
                    control={form.control}
                    name="ornitelaEnabled"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel>Sincronización con Ornitela</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-ornitela-enabled" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ornitelaPanelUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>URL del panel</FormLabel>
                        <FormControl>
                          <Input placeholder="https://cpanel.glosendas.net" data-testid="input-ornitela-panel-url" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ornitelaUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username Ornitela</FormLabel>
                        <FormControl>
                          <Input
                            type="text"
                            placeholder={editStudy ? "Dejar vacío para mantener actual" : "usuario"}
                            data-testid="input-ornitela-username"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ornitelaPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password Ornitela</FormLabel>
                        <FormControl>
                          <PasswordInput
                            placeholder={editStudy ? "Dejar vacío para mantener actual" : "••••••"}
                            autoComplete="new-password"
                            data-testid="input-ornitela-password"
                            toggleTestId="button-toggle-ornitela-password"
                            {...field}
                          />
                        </FormControl>
                        {editStudy && <FormDescription>Dejar vacío para mantener la credencial actual</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ornitelaSyncIntervalHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Intervalo de sincronización</FormLabel>
                        <FormControl>
                          <Select value={String(field.value || 6)} onValueChange={(v) => field.onChange(Number(v))}>
                            <SelectTrigger data-testid="select-ornitela-sync-interval">
                              <SelectValue placeholder="Seleccionar intervalo" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Cada 1 hora</SelectItem>
                              <SelectItem value="3">Cada 3 horas</SelectItem>
                              <SelectItem value="6">Cada 6 horas</SelectItem>
                              <SelectItem value="12">Cada 12 horas</SelectItem>
                              <SelectItem value="24">Cada 24 horas</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium mb-1">Dispositivos asignados (SFTP)</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      Los archivos SFTP con estos device_id se importan a este estudio. Al añadir un
                      dispositivo se reprocesan sus archivos sin asignar pendientes.
                    </p>
                    <OrnitelaDeviceAllowlist
                      study={editStudy}
                      localIds={newDeviceIds}
                      setLocalIds={setNewDeviceIds}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-study">
                  {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editStudy ? "Guardar cambios" : "Crear estudio"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteStudy} onOpenChange={(open) => !open && setDeleteStudy(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar estudio</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar "{deleteStudy?.name}"? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteStudy && deleteMutation.mutate(deleteStudy.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!assignStudy} onOpenChange={(open) => !open && setAssignStudy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar usuarios a "{assignStudy?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-64 overflow-auto py-2">
            {assignLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </div>
            ) : normalUsers.length > 0 ? (
              normalUsers.map((u) => {
                const isAssigned = studyUsers?.includes(u.id);
                return (
                  <div key={u.id} className="flex items-center gap-3 py-1" data-testid={`assign-user-${u.id}`}>
                    <Checkbox
                      checked={isAssigned}
                      onCheckedChange={(checked) => {
                        if (assignStudy) {
                          assignMutation.mutate({
                            studyId: assignStudy.id,
                            userId: u.id,
                            assign: !!checked,
                          });
                        }
                      }}
                    />
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay usuarios normales registrados
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrnitelaDeviceAllowlist({
  study,
  localIds,
  setLocalIds,
}: {
  study: Study | null;
  localIds: string[];
  setLocalIds: (ids: string[]) => void;
}) {
  const { toast } = useToast();
  const [input, setInput] = useState("");

  const { data: devices } = useQuery<OrnitelaDeviceStudy[]>({
    queryKey: ["/api/studies", study?.id, "ornitela-devices"],
    enabled: !!study,
  });

  const addMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await apiRequest("POST", `/api/studies/${study!.id}/ornitela-devices`, { deviceId });
      return (await res.json()) as { reprocessed: { files: number; gps: number; acc: number } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies", study?.id, "ornitela-devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/unassigned"] });
      const r = data.reprocessed;
      toast({
        title: "Dispositivo añadido",
        description:
          r.files > 0
            ? `Reprocesados ${r.files} archivo(s): ${r.gps} GPS, ${r.acc} ACC importados.`
            : "Sin archivos pendientes que reprocesar.",
      });
      setInput("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      await apiRequest("DELETE", `/api/studies/${study!.id}/ornitela-devices/${encodeURIComponent(deviceId)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies", study?.id, "ornitela-devices"] });
      toast({ title: "Dispositivo eliminado" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleAdd = () => {
    const id = input.trim();
    if (!id) return;
    if (study) {
      addMutation.mutate(id);
    } else {
      if (!localIds.includes(id)) setLocalIds([...localIds, id]);
      setInput("");
    }
  };

  const chips = study ? (devices ?? []).map((d) => d.deviceId) : localIds;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="device_id (IMEI)"
          data-testid="input-ornitela-device"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleAdd}
          disabled={addMutation.isPending}
          data-testid="button-add-ornitela-device"
        >
          {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Añadir"}
        </Button>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1" data-testid={`chip-device-${id}`}>
              {id}
              <button
                type="button"
                onClick={() => {
                  if (study) removeMutation.mutate(id);
                  else setLocalIds(localIds.filter((x) => x !== id));
                }}
                className="ml-1 hover:text-destructive"
                data-testid={`button-remove-device-${id}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ningún dispositivo asignado.</p>
      )}
    </div>
  );
}

function UnassignedFilesCard({ studies }: { studies: Study[] }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, string>>({});

  const { data: files, isLoading } = useQuery<UnassignedSftpFile[]>({
    queryKey: ["/api/sftp/unassigned"],
  });

  const assignMutation = useMutation({
    mutationFn: async ({ studyId, deviceId }: { studyId: string; deviceId: string }) => {
      const res = await apiRequest("POST", `/api/studies/${studyId}/ornitela-devices`, { deviceId });
      return (await res.json()) as { reprocessed: { files: number; gps: number; acc: number } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/unassigned"] });
      const r = data.reprocessed;
      toast({
        title: "Dispositivo asignado",
        description: `Reprocesados ${r.files} archivo(s): ${r.gps} GPS, ${r.acc} ACC importados.`,
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!isLoading && (!files || files.length === 0)) return null;

  const ornitelaStudies = studies.filter((s) => s.ornitelaEnabled);

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-1">
          <FileWarning className="w-5 h-5 text-amber-500" />
          <h3 className="text-base font-semibold">Archivos SFTP sin asignar</h3>
          {files && <Badge variant="destructive" data-testid="badge-unassigned-count">{files.length}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Estos archivos no se pudieron asignar a ningún estudio. Asigna su dispositivo a un estudio
          para importarlos.
        </p>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full rounded" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device ID</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>Fecha archivo</TableHead>
                <TableHead>Último intento</TableHead>
                <TableHead className="text-center">Reintentos</TableHead>
                <TableHead>Asignar a estudio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(files ?? []).map((f) => (
                <TableRow key={f.id} data-testid={`row-unassigned-${f.id}`}>
                  <TableCell className="font-mono text-xs">{f.deviceId ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate" title={f.filename}>
                    {f.filename}
                  </TableCell>
                  <TableCell className="text-xs">
                    {f.fileModifiedAt ? new Date(f.fileModifiedAt as any).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {f.lastAttemptAt ? new Date(f.lastAttemptAt as any).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-center text-xs">{f.retryCount}</TableCell>
                  <TableCell>
                    <div className="flex gap-2 items-center">
                      <Select
                        value={selected[f.id] ?? ""}
                        onValueChange={(v) => setSelected((prev) => ({ ...prev, [f.id]: v }))}
                        disabled={!f.deviceId}
                      >
                        <SelectTrigger className="h-8 w-[160px]" data-testid={`select-study-${f.id}`}>
                          <SelectValue placeholder="Estudio" />
                        </SelectTrigger>
                        <SelectContent>
                          {ornitelaStudies.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!f.deviceId || !selected[f.id] || assignMutation.isPending}
                        onClick={() =>
                          f.deviceId &&
                          selected[f.id] &&
                          assignMutation.mutate({ studyId: selected[f.id], deviceId: f.deviceId })
                        }
                        data-testid={`button-assign-${f.id}`}
                      >
                        Asignar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
