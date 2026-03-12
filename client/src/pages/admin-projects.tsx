import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Project, Species } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Loader2, FolderOpen } from "lucide-react";

const projectFormSchema = z.object({
  descripcion: z.string().min(2, "Descripción requerida"),
  idEspecie: z.string().optional(),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

export default function AdminProjects() {
  const { toast } = useToast();
  const [editItem, setEditItem] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteItem, setDeleteItem] = useState<Project | null>(null);
  const [search, setSearch] = useState("");

  const { data: projectList, isLoading } = useQuery<(Project & { animalCount: number })[]>({
    queryKey: ["/api/projects"],
  });

  const { data: speciesList } = useQuery<Species[]>({
    queryKey: ["/api/species"],
  });

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { descripcion: "", idEspecie: "" },
  });

  const openCreate = () => {
    setEditItem(null);
    form.reset({ descripcion: "", idEspecie: "" });
    setShowForm(true);
  };

  const openEdit = (item: Project) => {
    setEditItem(item);
    form.reset({
      descripcion: item.descripcion,
      idEspecie: item.idEspecie ? String(item.idEspecie) : "",
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: ProjectFormValues) => {
      const payload = {
        descripcion: values.descripcion,
        idEspecie: values.idEspecie && values.idEspecie !== "__none__" ? Number(values.idEspecie) : null,
      };
      if (editItem) {
        await apiRequest("PATCH", `/api/projects/${editItem.id}`, payload);
      } else {
        await apiRequest("POST", "/api/projects", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowForm(false);
      toast({ title: editItem ? "Proyecto actualizado" : "Proyecto creado" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setDeleteItem(null);
      toast({ title: "Proyecto eliminado" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const speciesMap = new Map((speciesList || []).map(s => [s.id, s]));

  const filtered = (projectList || []).filter(p =>
    !search || p.descripcion.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Administración", href: "/admin/studies" }, { label: "Proyectos" }]} />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-projects-title">
            Proyectos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los proyectos de referencia del sistema
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-create-project">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo proyecto
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Buscar proyectos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
          data-testid="input-search-projects"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
            </div>
          ) : filtered.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Especie asociada</TableHead>
                    <TableHead>Nº animales</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((proj) => (
                    <TableRow key={proj.id} data-testid={`row-project-${proj.id}`}>
                      <TableCell className="text-muted-foreground">{proj.id}</TableCell>
                      <TableCell className="font-medium">{proj.descripcion}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {proj.idEspecie ? speciesMap.get(proj.idEspecie)?.nombreComun || `ID ${proj.idEspecie}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground" data-testid={`text-project-animal-count-${proj.id}`}>{proj.animalCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(proj)} data-testid={`button-edit-project-${proj.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteItem(proj)} data-testid={`button-delete-project-${proj.id}`}>
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
              <FolderOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {search ? "Sin resultados para la búsqueda" : "No hay proyectos registrados"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Seguimiento Milano real" data-testid="input-project-descripcion" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="idEspecie"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Especie asociada (opcional)</FormLabel>
                    <FormControl>
                      <Select value={field.value || ""} onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}>
                        <SelectTrigger data-testid="select-project-species">
                          <SelectValue placeholder="Sin especie" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especie</SelectItem>
                          {(speciesList || []).map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.nombreComun} ({s.nombreCientifico})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>Vincula este proyecto a una especie del catálogo</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-submit-project">
                  {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editItem ? "Guardar" : "Crear"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar proyecto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar <strong>{deleteItem?.descripcion}</strong>? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} data-testid="button-confirm-delete-project">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
