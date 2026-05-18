import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EVENT_LABELS, EVENT_COLORS, type DetectedEvent, type EventType } from "@shared/schema";

interface AlertHistoryResponse {
  events: DetectedEvent[];
  total: number;
  stats?: any;
}

function timeAgo(ts: number | string | Date | null): string {
  if (!ts) return "";
  const date = typeof ts === "string" || ts instanceof Date ? new Date(ts).getTime() : ts;
  const diff = Date.now() - date;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AlertHistoryResponse>({
    queryKey: ["/api/alerts/history", { readStatus: "false", limit: 15 }],
    queryFn: async () => {
      const res = await fetch("/api/alerts/history?readStatus=false&limit=15", { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando alertas");
      return res.json();
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const events = data?.events ?? [];
  const unreadCount = data?.total ?? events.length;

  const bellKey = ["/api/alerts/history", { readStatus: "false", limit: 15 }] as const;

  const markOneRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/alerts/${id}/read`, {});
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: bellKey });
      const prev = queryClient.getQueryData<AlertHistoryResponse>(bellKey);
      if (prev) {
        const nextEvents = prev.events.filter((e) => e.id !== id);
        queryClient.setQueryData<AlertHistoryResponse>(bellKey, {
          ...prev,
          events: nextEvents,
          total: Math.max(0, (prev.total ?? nextEvents.length + 1) - 1),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(bellKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = events.map((e) => e.id);
      if (ids.length === 0) return;
      await apiRequest("PATCH", "/api/alerts/bulk/read", { ids });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: bellKey });
      const prev = queryClient.getQueryData<AlertHistoryResponse>(bellKey);
      queryClient.setQueryData<AlertHistoryResponse>(bellKey, {
        events: [],
        total: 0,
        stats: prev?.stats,
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(bellKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    },
    onSuccess: () => {
      toast({ title: "Notificaciones marcadas como leídas" });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notification-bell"
          aria-label="Notificaciones"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center rounded-full"
              data-testid="badge-notification-count"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-testid="popover-notifications">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <span className="font-semibold text-sm" data-testid="text-notifications-title">
              Notificaciones
            </span>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px]" data-testid="badge-unread-count">
                {unreadCount} sin leer
              </Badge>
            )}
          </div>
          {events.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar todas
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-96">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-notifications-loading">
              Cargando…
            </div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground" data-testid="text-notifications-empty">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No tienes notificaciones nuevas
            </div>
          ) : (
            <div className="divide-y">
              {events.map((event) => {
                const type = event.eventType as EventType;
                const color = EVENT_COLORS[type] ?? "#888";
                const label = EVENT_LABELS[type] ?? event.eventType;
                return (
                  <div
                    key={event.id}
                    className="p-3 hover:bg-muted/50 transition-colors"
                    data-testid={`notification-item-${event.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-xs font-medium" style={{ color }}>
                            {label}
                          </span>
                          {event.severity === "critical" && (
                            <Badge variant="destructive" className="h-4 text-[9px] px-1">
                              CRÍTICO
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm truncate" data-testid={`text-notification-animal-${event.id}`}>
                          Animal <span className="font-mono">{event.individualLocalId}</span>
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {event.description}
                        </p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(event.createdAt)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => markOneRead.mutate(event.id)}
                            disabled={markOneRead.isPending}
                            data-testid={`button-mark-read-${event.id}`}
                          >
                            Marcar leída
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <Separator />
        <div className="p-2">
          <Link href="/alerts">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs gap-1"
              onClick={() => setOpen(false)}
              data-testid="button-view-all-notifications"
            >
              Ver historial completo
              <ExternalLink className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
