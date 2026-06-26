import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { VERSION, CHANGES } from "@/changelog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const STORAGE_KEY = `wildtrack_changelog_seen_v${VERSION}`;

export function ChangelogModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage no disponible; el modal simplemente reaparecerá
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-changelog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <DialogTitle data-testid="text-changelog-title">Novedades en WildTrack</DialogTitle>
            <Badge variant="secondary" data-testid="badge-changelog-version">v{VERSION}</Badge>
          </div>
          <DialogDescription>
            Estos son los últimos cambios aplicados a la plataforma.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          {CHANGES.map((change, i) => (
            <li
              key={i}
              className="flex gap-2 text-sm text-foreground"
              data-testid={`text-changelog-item-${i}`}
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{change}</span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={handleClose} data-testid="button-changelog-dismiss">
            Entendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
