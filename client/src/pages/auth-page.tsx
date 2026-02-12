import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PawPrint } from "lucide-react";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!loginEmail || !/\S+@\S+\.\S+/.test(loginEmail)) newErrors.loginEmail = "Email inválido";
    if (!loginPassword || loginPassword.length < 6) newErrors.loginPassword = "Mínimo 6 caracteres";
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});
    setLoading(true);
    try {
      await login(loginEmail, loginPassword);
      setLocation("/");
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Credenciales inválidas", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!regName || regName.length < 2) newErrors.regName = "Mínimo 2 caracteres";
    if (!regEmail || !/\S+@\S+\.\S+/.test(regEmail)) newErrors.regEmail = "Email inválido";
    if (!regPassword || regPassword.length < 6) newErrors.regPassword = "Mínimo 6 caracteres";
    if (regPassword !== regConfirm) newErrors.regConfirm = "Las contraseñas no coinciden";
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});
    setLoading(true);
    try {
      await register(regName, regEmail, regPassword);
      setLocation("/");
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Error al registrar", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-md bg-primary/10">
              <PawPrint className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">WildTrack</h1>
          </div>
          <p className="text-sm text-muted-foreground">Sistema de seguimiento de fauna silvestre</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex gap-1">
              <Button
                variant={mode === "login" ? "default" : "ghost"}
                className="flex-1"
                onClick={() => { setMode("login"); setErrors({}); }}
                data-testid="button-switch-login"
              >
                Iniciar sesión
              </Button>
              <Button
                variant={mode === "register" ? "default" : "ghost"}
                className="flex-1"
                onClick={() => { setMode("register"); setErrors({}); }}
                data-testid="button-switch-register"
              >
                Registrarse
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {mode === "login" ? (
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="tu@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    data-testid="input-login-email"
                  />
                  {errors.loginEmail && <p className="text-sm text-destructive">{errors.loginEmail}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Contraseña</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    data-testid="input-login-password"
                  />
                  {errors.loginPassword && <p className="text-sm text-destructive">{errors.loginPassword}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-login-submit">
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Iniciar sesión
                </Button>
              </form>
            ) : (
              <form onSubmit={onRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">Nombre</Label>
                  <Input
                    id="reg-name"
                    type="text"
                    placeholder="Tu nombre"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    data-testid="input-register-name"
                  />
                  {errors.regName && <p className="text-sm text-destructive">{errors.regName}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="tu@email.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    data-testid="input-register-email"
                  />
                  {errors.regEmail && <p className="text-sm text-destructive">{errors.regEmail}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">Contraseña</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="••••••"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    data-testid="input-register-password"
                  />
                  {errors.regPassword && <p className="text-sm text-destructive">{errors.regPassword}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-confirm">Confirmar contraseña</Label>
                  <Input
                    id="reg-confirm"
                    type="password"
                    placeholder="••••••"
                    value={regConfirm}
                    onChange={(e) => setRegConfirm(e.target.value)}
                    data-testid="input-register-confirm"
                  />
                  {errors.regConfirm && <p className="text-sm text-destructive">{errors.regConfirm}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-register-submit">
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Registrarse
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  El primer usuario registrado será superusuario
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
