import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Study, User, SpeciesProfile } from "@shared/schema";
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
import { Plus, Pencil, Trash2, Users, Loader2, Radio, Settings } from "lucide-react";

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
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: StudyFormValues) => {
      if (editStudy) {
        await apiRequest("PATCH", `/api/studies/${editStudy.id}`, values);
      } else {
        await apiRequest("POST", "/api/studies", values);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      setShowForm(false);
      toast({ title: editStudy ? "Estudio actualizado" : "Estudio creado" });
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

  const normalUsers = allUsers?.filter((u) => u.role !== "superuser") || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-studies-title">
            Gestionar estudios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crea, edita y asigna estudios de Movebank
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

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editStudy ? "Editar estudio" : "Nuevo estudio"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <Tabs defaultValue="general" className="w-full">
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
