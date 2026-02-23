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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Users, Shield, Plus, UserPlus, Radio, Loader2, MoreVertical, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function AdminUsers() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAlertEmail, setNewAlertEmail] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [selectedStudy, setSelectedStudy] = useState("");
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordName, setResetPasswordName] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");

  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: studies } = useQuery<Study[]>({ queryKey: ["/api/studies"] });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users", {
        name: newName,
        email: newEmail,
        password: newPassword,
        alertEmail: newAlertEmail || null,
        role: newRole,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Usuario creado exitosamente" });
      setShowCreate(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewAlertEmail(""); setNewRole("user");
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

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${userId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Rol actualizado exitosamente" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${userId}`, { newPassword });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Contraseña restablecida exitosamente" });
      setResetPasswordUserId(null);
      setResetNewPassword("");
      setResetConfirmPassword("");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const canResetPassword = resetNewPassword.length >= 6 && resetNewPassword === resetConfirmPassword;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Breadcrumbs items={[{ label: "Administración", href: "/admin/studies" }, { label: "Usuarios" }]} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-admin-users-title">
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los usuarios del sistema, sus roles y asignaciones de estudios
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setNewName(""); setNewEmail(""); setNewPassword(""); setNewAlertEmail(""); setNewRole("user"); } }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <UserPlus className="w-4 h-4 mr-2" />
              Crear usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear nuevo usuario</DialogTitle>
              <DialogDescription>Completa los datos para registrar un nuevo usuario en el sistema</DialogDescription>
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
                <Label>Contraseña</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" data-testid="input-new-user-password" />
              </div>
              <div className="space-y-1">
                <Label>Email para alertas (opcional)</Label>
                <Input type="email" value={newAlertEmail} onChange={(e) => setNewAlertEmail(e.target.value)} placeholder="alertas@ejemplo.com" data-testid="input-new-user-alert-email" />
              </div>
              <div className="space-y-1">
                <Label>Rol</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger data-testid="select-new-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuario</SelectItem>
                    <SelectItem value="superuser">Superusuario</SelectItem>
                  </SelectContent>
                </Select>
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
                    <TableHead className="text-right">Acciones</TableHead>
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
                    const isCurrentUser = currentUser?.id === u.id;
                    return (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <span className="font-medium">{u.name}</span>
                              {isCurrentUser && (
                                <span className="ml-2 text-xs text-muted-foreground">(tú)</span>
                              )}
                            </div>
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
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" data-testid={`button-user-actions-${u.id}`}>
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {!isCurrentUser && (
                                  <>
                                    {u.role === "user" ? (
                                      <DropdownMenuItem
                                        onClick={() => changeRoleMutation.mutate({ userId: u.id, role: "superuser" })}
                                        data-testid={`button-promote-${u.id}`}
                                      >
                                        <ShieldCheck className="w-4 h-4 mr-2" />
                                        Promover a superusuario
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem
                                        onClick={() => changeRoleMutation.mutate({ userId: u.id, role: "user" })}
                                        data-testid={`button-demote-${u.id}`}
                                      >
                                        <ShieldOff className="w-4 h-4 mr-2" />
                                        Cambiar a usuario normal
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                  </>
                                )}
                                <DropdownMenuItem
                                  onClick={() => {
                                    setResetPasswordUserId(u.id);
                                    setResetPasswordName(u.name);
                                    setResetNewPassword("");
                                    setResetConfirmPassword("");
                                  }}
                                  data-testid={`button-reset-password-${u.id}`}
                                >
                                  <KeyRound className="w-4 h-4 mr-2" />
                                  Restablecer contraseña
                                </DropdownMenuItem>
                                {u.role !== "superuser" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => { setAssignUserId(u.id); setSelectedStudy(""); }}
                                      data-testid={`button-assign-study-${u.id}`}
                                    >
                                      <Radio className="w-4 h-4 mr-2" />
                                      Asignar estudio
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
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

      <Dialog open={!!resetPasswordUserId} onOpenChange={(open) => { if (!open) { setResetPasswordUserId(null); setResetNewPassword(""); setResetConfirmPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restablecer contraseña</DialogTitle>
            <DialogDescription>
              Establece una nueva contraseña para <strong>{resetPasswordName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nueva contraseña</Label>
              <Input
                type="password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                data-testid="input-reset-password"
              />
            </div>
            <div className="space-y-1">
              <Label>Confirmar contraseña</Label>
              <Input
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                data-testid="input-reset-password-confirm"
              />
              {resetConfirmPassword.length > 0 && resetNewPassword !== resetConfirmPassword && (
                <p className="text-xs text-destructive mt-1">Las contraseñas no coinciden</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordUserId(null)}>Cancelar</Button>
            <Button
              onClick={() => resetPasswordUserId && resetPasswordMutation.mutate({ userId: resetPasswordUserId, newPassword: resetNewPassword })}
              disabled={!canResetPassword || resetPasswordMutation.isPending}
              data-testid="button-submit-reset-password"
            >
              {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Restablecer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignUserId} onOpenChange={(open) => { if (!open) { setAssignUserId(null); setSelectedStudy(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar estudio</DialogTitle>
            <DialogDescription>Selecciona el estudio a asignar</DialogDescription>
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
              onClick={() => assignUserId && assignStudyMutation.mutate({ userId: assignUserId, studyId: selectedStudy })}
              disabled={!selectedStudy || assignStudyMutation.isPending}
              data-testid="button-submit-assign"
            >
              Asignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
