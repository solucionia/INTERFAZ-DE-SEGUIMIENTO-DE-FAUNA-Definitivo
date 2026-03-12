import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Species } from "@shared/schema";
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
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Loader2, Bug } from "lucide-react";

const speciesFormSchema = z.object({
  nombreComun: z.string().min(2, "Nombre común requerido"),
  nombreCientifico: z.string().min(2, "Nombre científico requerido"),
});

type SpeciesFormValues = z.infer<typeof speciesFormSchema>;

export default function AdminSpecies() {
  const { toast } = useToast();
  const [editItem, setEditItem] = useState<Species | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteItem, setDeleteItem] = useState<Species | null>(null);

  const { data: speciesList, isLoading } = useQuery<(Species & { projectCount: number })[]>({
    queryKey: ["/api/species"],
  });

  const form = useForm<SpeciesFormValues>({
    resolver: zodResolver(speciesFormSchema),
    defaultValues: { nombreComun: "", nombreCientifico: "" },
  });

  const openCreate = () => {
    setEditItem(null);
    form.reset({ nombreComun: "", nombreCientifico: "" });
    setShowForm(true);
  };

  const openEdit = (item: Species) => {
    setEditItem(item);
    form.reset({ nombreComun: item.nombreComun, nombreCientifico: item.nombreCientifico });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: SpeciesFormValues) => {
      if (editItem) {
        await apiRequest("PATCH", `/api/species/${editItem.id}`, values);
      } else {
        await apiRequest("POST", "/api/species", values);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/species"] });
      setShowForm(false);
      toast({ title: editItem ? "Especie actualizada" : "Especie creada" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/species/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/species"] });
      setDeleteItem(null);
      toast({ title: "Especie eliminada" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/import-reference-data");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/species"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Datos importados",
        description: `Especies: ${data.speciesInserted} nuevas, ${data.speciesSkipped} existentes. Proyectos: ${data.projectsInserted} nuevos, ${data.projectsSkipped} existentes.`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Administración", href: "/admin/studies" }, { label: "Especies" }]} />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-species-title">
            Catálogo de especies
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona el catálogo de referencia de especies
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending} data-testid="button-import-reference">
            {importMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Importar datos iniciales
          </Button>
          <Button onClick={openCreate} data-testid="button-create-species">
            <Plus className="w-4 h-4 mr-2" />
            Nueva especie
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
            </div>
          ) : speciesList && speciesList.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Nombre común</TableHead>
                    <TableHead>Nombre científico</TableHead>
                    <TableHead>Nº proyectos</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {speciesList.map((sp) => (
                    <TableRow key={sp.id} data-testid={`row-species-${sp.id}`}>
                      <TableCell className="text-muted-foreground">{sp.id}</TableCell>
                      <TableCell className="font-medium">{sp.nombreComun}</TableCell>
                      <TableCell className="italic text-muted-foreground">{sp.nombreCientifico}</TableCell>
                      <TableCell className="text-muted-foreground" data-testid={`text-species-project-count-${sp.id}`}>{sp.projectCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(sp)} data-testid={`button-edit-species-${sp.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteItem(sp)} data-testid={`button-delete-species-${sp.id}`}>
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
              <Bug className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay especies registradas</p>
              <p className="text-xs text-muted-foreground mt-1">Usa "Importar datos iniciales" para cargar el catálogo</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editItem ? "Editar especie" : "Nueva especie"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="nombreComun"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre común</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Águila real" data-testid="input-species-nombre-comun" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nombreCientifico"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre científico</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Aquila chrysaetos" data-testid="input-species-nombre-cientifico" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-submit-species">
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
            <AlertDialogTitle>Eliminar especie</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar <strong>{deleteItem?.nombreComun}</strong>? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} data-testid="button-confirm-delete-species">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
