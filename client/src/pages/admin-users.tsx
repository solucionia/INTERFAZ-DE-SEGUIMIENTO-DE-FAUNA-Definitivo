import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User, Study } from "@shared/schema";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Users, Shield, Plus, UserPlus, Radio, X, Loader2 } from "lucide-react";

export default function AdminUsers() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAlertEmail, setNewAlertEmail] = useState("");
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [selectedStudy, setSelectedStudy] = useState("");

  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: studies } = useQuery<Study[]>({ queryKey: ["/api/studies"] });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users", {
        name: newName,
        email: newEmail,
        password: newPassword,
        alertEmail: newAlertEmail || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Usuario creado exitosamente" });
      setShowCreate(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewAlertEmail("");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const assignStudyMutation = useMutation({
    mutationFn: async ({ userId, studyId }: { userId: string; studyId: string }) => {
      await apiRequest("POST", `/api/studies/${studyId}/users`, { userId });
    },
    onSuccess: () => {
      toast({ title: "Estudio asignado" });
      setAssignUserId(null);
      setSelectedStudy("");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Administracion", href: "/admin/studies" }, { label: "Usuarios" }]} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-users-title">
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los usuarios del sistema y asignales estudios
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <UserPlus className="w-4 h-4 mr-2" />
              Crear usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear nuevo usuario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre completo" data-testid="input-new-user-name" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="correo@ejemplo.com" data-testid="input-new-user-email" />
              </div>
              <div className="space-y-1">
                <Label>Contrasena</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimo 6 caracteres" data-testid="input-new-user-password" />
              </div>
              <div className="space-y-1">
                <Label>Email para alertas (opcional)</Label>
                <Input type="email" value={newAlertEmail} onChange={(e) => setNewAlertEmail(e.target.value)} placeholder="alertas@ejemplo.com" data-testid="input-new-user-alert-email" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button onClick={() => createUserMutation.mutate()} disabled={createUserMutation.isPending || !newName || !newEmail || newPassword.length < 6} data-testid="button-submit-create-user">
                {createUserMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
            </div>
          ) : users && users.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Email alertas</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const initials = u.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2);
                    return (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{u.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          {u.role === "superuser" ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                              <Shield className="w-3 h-3 mr-1" />
                              Superusuario
                            </Badge>
                          ) : (
                            <Badge variant="outline">Usuario</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {(u as any).alertEmail || "-"}
                        </TableCell>
                        <TableCell>
                          {u.role !== "superuser" && (
                            <Dialog open={assignUserId === u.id} onOpenChange={(open) => { setAssignUserId(open ? u.id : null); setSelectedStudy(""); }}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" data-testid={`button-assign-study-${u.id}`}>
                                  <Radio className="w-4 h-4 mr-1" />
                                  Asignar estudio
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Asignar estudio a {u.name}</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-3 py-2">
                                  <Label>Seleccionar estudio</Label>
                                  <Select value={selectedStudy} onValueChange={setSelectedStudy}>
                                    <SelectTrigger data-testid="select-assign-study"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                    <SelectContent>
                                      {(studies || []).map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setAssignUserId(null)}>Cancelar</Button>
                                  <Button
                                    onClick={() => assignStudyMutation.mutate({ userId: u.id, studyId: selectedStudy })}
                                    disabled={!selectedStudy || assignStudyMutation.isPending}
                                    data-testid="button-submit-assign"
                                  >
                                    Asignar
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay usuarios registrados</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
