import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import type { Study } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X, Eye, Info, MapPin, Plus } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type ImportFormat = "auto" | "movebank" | "baselunar" | "ornitella";

type ImportResult = {
  imported: number;
  duplicates: number;
  errors: number;
  details: string[];
  dataType: string;
  individuals: number;
  individuals_created?: number;
  format?: string;
  accImported?: number;
  accDuplicates?: number;
  ornitela_subformat?: string;
  gpsRows?: number;
  sensorsRows?: number;
  isV2?: boolean;
};

type ParsedPreview = {
  headers: string[];
  rows: string[][];
  totalRows: number;
  separator: string;
  detectedFormat: "movebank" | "baselunar" | "ornitella" | "unknown";
};

function detectFormat(headers: string[]): "movebank" | "baselunar" | "ornitella" | "unknown" {
  const lower = headers.map((h) => h.toLowerCase());
  const ornitelaDeviceNames = ["device_id", "deviceid", "dev_id", "tagid", "tag_id"];
  const ornitelaDtNames = ["utc_datetime", "datetime_utc", "utc_date", "utc_time", "datetime", "date_time"];
  const hasOrnitella = ornitelaDeviceNames.some(n => lower.includes(n)) && ornitelaDtNames.some(n => lower.includes(n));
  if (hasOrnitella) return "ornitella";
  const hasBaseLunar = lower.includes("nombre") && lower.includes("fecha") && lower.includes("hora") && lower.includes("x") && lower.includes("y");
  if (hasBaseLunar) return "baselunar";
  const hasMovebank = lower.includes("timestamp") && (lower.includes("individual-local-identifier") || lower.includes("individual_local_identifier"));
  if (hasMovebank) return "movebank";
  return "unknown";
}

function detectOrnitelaSubtype(headers: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  const latNames = ["latitude", "lat", "location_lat"];
  const lonNames = ["longitude", "lon", "lng", "location_lon", "location_long"];
  const accXNames = ["acc_x", "acceleration_x", "accel_x", "x_acceleration"];
  const accYNames = ["acc_y", "acceleration_y", "accel_y", "y_acceleration"];
  const accZNames = ["acc_z", "acceleration_z", "accel_z", "z_acceleration"];
  const hasGps = latNames.some(n => lower.includes(n)) && lonNames.some(n => lower.includes(n));
  const hasAcc = accXNames.some(n => lower.includes(n)) && accYNames.some(n => lower.includes(n)) && accZNames.some(n => lower.includes(n));
  const v1Names = new Set(["device_id", "utc_datetime", "latitude", "longitude", "altitude_m", "speed_km_h", "direction_deg", "acc_x", "acc_y", "acc_z"]);
  const v2AltNames = ["deviceid","dev_id","tagid","tag_id","datetime_utc","utc_date","utc_time","datetime","date_time","acceleration_x","accel_x","x_acceleration","acceleration_y","accel_y","y_acceleration","acceleration_z","accel_z","z_acceleration","altitude","alt","height_m","height","speed","speed_kmh","velocity_km_h","direction","heading","heading_deg","course","lat","lon","lng","location_lat","location_lon","location_long"];
  const isV2 = lower.some(h => v2AltNames.includes(h) && !v1Names.has(h));
  let sub = "";
  if (hasGps && hasAcc) sub = "GPS+SENSORS";
  else if (hasGps) sub = "GPS";
  else if (hasAcc) sub = "SENSORS";
  else sub = "desconocido";
  return sub + (isV2 ? " V2" : "");
}

const FORMAT_LABELS: Record<string, string> = {
  movebank: "Movebank",
  baselunar: "Base Lunar",
  ornitella: "Ornitella",
  auto: "Detectar automaticamente",
  unknown: "No detectado",
};

export default function ImportCsv() {
  const [, params] = useRoute("/study/:id/import");
  const preselectedStudyId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { canImport } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedStudyId, setSelectedStudyId] = useState<string>(preselectedStudyId || "");
  const [dataType, setDataType] = useState<"gps" | "acc">("gps");
  const [format, setFormatRaw] = useState<ImportFormat>("auto");
  const setFormat = useCallback((f: ImportFormat) => {
    setFormatRaw(f);
    if (f === "baselunar" || f === "ornitella") setDataType("gps");
  }, []);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: studies } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const activeStudyId = selectedStudyId || preselectedStudyId || "";

  const selectedStudy = useMemo(() => {
    return studies?.find((s) => s.id === activeStudyId);
  }, [studies, activeStudyId]);

  const effectiveFormat = useMemo(() => {
    if (format !== "auto") return format;
    if (preview) return preview.detectedFormat === "unknown" ? "movebank" : preview.detectedFormat;
    return "auto";
  }, [format, preview]);


  const parsePreview = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        toast({ title: "Archivo invalido", description: "El archivo debe tener al menos una cabecera y una fila de datos", variant: "destructive" });
        return;
      }
      const hasSemicolon = lines[0].includes(";");
      const separator = hasSemicolon ? ";" : (lines[0].includes("\t") ? "\t" : ",");
      const headers = lines[0].split(separator).map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
      const rows: string[][] = [];
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        rows.push(lines[i].split(separator).map((v) => v.trim().replace(/^"/, "").replace(/"$/, "")));
      }
      const detectedFormat = detectFormat(headers);
      setPreview({ headers, rows, totalRows: lines.length - 1, separator, detectedFormat });
      if (detectedFormat === "baselunar" || detectedFormat === "ornitella") {
        setDataType("gps");
      }
    };
    reader.readAsText(f.slice(0, 1024 * 200));
  }, [toast]);

  const validateFile = useCallback((f: File): string | null => {
    if (f.size > 200 * 1024 * 1024) return "supera el tamaño máximo de 200MB";
    const name = f.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".tsv") && !name.endsWith(".txt")) {
      return "solo se aceptan archivos CSV, TSV o TXT";
    }
    return null;
  }, []);

  const handleFilesSelect = useCallback((incoming: File[]) => {
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of incoming) {
      const err = validateFile(f);
      if (err) {
        rejected.push(`${f.name}: ${err}`);
      } else {
        accepted.push(f);
      }
    }
    if (rejected.length > 0) {
      toast({
        title: rejected.length === 1 ? "Archivo rechazado" : "Archivos rechazados",
        description: rejected.join(" — "),
        variant: "destructive",
      });
    }
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of accepted) {
        const dup = merged.some((m) => m.name === f.name && m.size === f.size);
        if (!dup) merged.push(f);
      }
      if (merged.length > 0) parsePreview(merged[0]);
      return merged;
    });
    setResult(null);
  }, [toast, parsePreview, validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) handleFilesSelect(dropped);
  }, [handleFilesSelect]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setPreview(null);
        setResult(null);
        setProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else if (index === 0) {
        parsePreview(next[0]);
      }
      return next;
    });
  }, [parsePreview]);

  const handleUpload = async () => {
    if (files.length !== 1 || !activeStudyId) return;
    const file = files[0];

    setUploading(true);
    setProgress(10);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dataType", dataType);
      formData.append("format", format);

      setProgress(30);

      const res = await fetch(`/api/studies/${activeStudyId}/import-csv`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      setProgress(90);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Error al importar");
      }

      const data: ImportResult = await res.json();
      setResult(data);
      setProgress(100);

      queryClient.invalidateQueries({ queryKey: ["/api/studies", activeStudyId, "individuals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", activeStudyId, "gps-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies", activeStudyId] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          (query.queryKey[0] as string).includes(`/api/studies/${activeStudyId}/last-positions`),
      });

      const accInfo = data.format === "ornitella" && data.accImported !== undefined
        ? ` + ${data.accImported} acelerómetro`
        : "";
      toast({
        title: "Importación completada",
        description: `${data.imported} GPS importados${accInfo}, ${data.duplicates} duplicados ignorados`,
      });
    } catch (e: any) {
      toast({ title: "Error al importar", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setPreview(null);
    setResult(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const breadcrumbs = preselectedStudyId && selectedStudy
    ? [{ label: selectedStudy.name, href: `/study/${preselectedStudyId}` }, { label: "Importar CSV" }]
    : [{ label: "Importar CSV" }];

  if (!canImport) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-import-title">Importar datos CSV</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-lg font-medium text-muted-foreground">Acceso restringido</p>
            <p className="text-sm text-muted-foreground mt-1">No tienes permisos para importar datos. Contacta a un administrador.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-import-title">Importar datos CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Carga datos GPS o acelerómetro desde archivos CSV de Movebank, Base Lunar u Ornitella
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Estudio destino</label>
              <Select
                value={activeStudyId}
                onValueChange={setSelectedStudyId}
                disabled={!!preselectedStudyId}
              >
                <SelectTrigger data-testid="select-study">
                  <SelectValue placeholder="Seleccionar estudio" />
                </SelectTrigger>
                <SelectContent>
                  {studies?.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-testid={`option-study-${s.id}`}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Tipo de datos</label>
              <Select
                value={dataType}
                onValueChange={(v) => setDataType(v as "gps" | "acc")}
                disabled={effectiveFormat === "baselunar" || effectiveFormat === "ornitella"}
              >
                <SelectTrigger data-testid="select-data-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gps">GPS (sensor 653)</SelectItem>
                  <SelectItem value="acc">Acelerometro (sensor 2365683)</SelectItem>
                </SelectContent>
              </Select>
              {effectiveFormat === "baselunar" && (
                <p className="text-xs text-muted-foreground mt-1">Base Lunar solo soporta GPS</p>
              )}
              {effectiveFormat === "ornitella" && (
                <p className="text-xs text-muted-foreground mt-1">Ornitella importa GPS + acelerómetro automáticamente</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Formato de origen</label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as ImportFormat)}
              >
                <SelectTrigger data-testid="select-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Detectar automaticamente</SelectItem>
                  <SelectItem value="movebank">Movebank</SelectItem>
                  <SelectItem value="baselunar">Base Lunar</SelectItem>
                  <SelectItem value="ornitella">Ornitella</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              {files.length > 1 ? `Archivos CSV (${files.length})` : "Archivo CSV"}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              multiple
              className="hidden"
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                if (selected.length > 0) handleFilesSelect(selected);
                e.target.value = "";
              }}
              data-testid="input-file"
            />
            {files.length === 0 ? (
              <div
                className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                data-testid="dropzone-csv"
              >
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground mb-1">
                  Arrastra uno o varios archivos CSV aqui o haz clic para seleccionar
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Maximo 200MB por archivo — Separador coma, punto y coma o tabulador
                </p>
              </div>
            ) : (
              <div
                className={`space-y-2 rounded-md ${dragOver ? "ring-2 ring-primary/50" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                data-testid="list-files"
              >
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border" data-testid={`row-file-${i}`}>
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-filename-${i}`}>{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(f.size / 1024).toFixed(1)} KB
                        {i === 0 && preview && ` — ${preview.totalRows.toLocaleString()} filas`}
                        {i === 0 && preview && ` — separador: "${preview.separator === ";" ? ";" : preview.separator === "\t" ? "TAB" : ","}"`}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeFile(i)} data-testid={`button-remove-file-${i}`}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-add-files">
                    <Plus className="w-4 h-4 mr-1" />
                    Añadir más archivos
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={clearFiles} data-testid="button-clear-files">
                    Quitar todos
                  </Button>
                </div>
                {files.length > 1 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-multi-hint">
                    La vista previa corresponde al primer archivo. La importación de varios archivos a la vez estará disponible en el siguiente paso; de momento, deja solo un archivo en la lista para importar.
                  </p>
                )}
              </div>
            )}
          </div>

          {preview && format === "auto" && preview.detectedFormat !== "unknown" && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted/30 border">
              <Info className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm text-muted-foreground" data-testid="text-detected-format">
                Formato detectado: <span className="font-medium text-foreground">{FORMAT_LABELS[preview.detectedFormat]}</span>
                {preview.detectedFormat === "baselunar" && " (separador punto y coma, columnas nombre/fecha/hora/x/y)"}
                {preview.detectedFormat === "movebank" && " (separador coma, columnas timestamp/individual-local-identifier)"}
                {preview.detectedFormat === "ornitella" && ` (Ornitela ${detectOrnitelaSubtype(preview.headers)})`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {preview && !result && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Vista previa (primeras {preview.rows.length} filas)</h3>
              {effectiveFormat !== "auto" && (
                <Badge variant="outline" data-testid="badge-format">{FORMAT_LABELS[effectiveFormat]}</Badge>
              )}
            </div>

            {effectiveFormat === "baselunar" && (
              <div className="text-xs text-muted-foreground space-y-0.5 p-2 rounded-md bg-muted/30 border">
                <p className="font-medium text-foreground mb-1">Mapeo Base Lunar:</p>
                <p>nombre → identificador del individuo | fecha + hora → timestamp</p>
                <p>x → longitud (WGS84) | y → latitud (WGS84)</p>
                <p>velocidad → ground_speed | curso → heading | altitud → height</p>
                <p>nombre_comun → especie | sexo → sexo del individuo</p>
              </div>
            )}

            {effectiveFormat === "ornitella" && preview && (
              <div className="text-xs text-muted-foreground space-y-0.5 p-2 rounded-md bg-muted/30 border">
                <p className="font-medium text-foreground mb-1">Formato Ornitela detectado: {detectOrnitelaSubtype(preview.headers)}</p>
                <p>device_id → identificador del individuo (se crea automáticamente)</p>
                <p>UTC_datetime → timestamp (UTC)</p>
                {(() => {
                  const lower = preview.headers.map(h => h.toLowerCase());
                  const hasGps = ["latitude","lat","location_lat"].some(n => lower.includes(n)) && ["longitude","lon","lng","location_lon","location_long"].some(n => lower.includes(n));
                  const hasAcc = ["acc_x","acceleration_x","accel_x","x_acceleration"].some(n => lower.includes(n)) && ["acc_y","acceleration_y","accel_y","y_acceleration"].some(n => lower.includes(n)) && ["acc_z","acceleration_z","accel_z","z_acceleration"].some(n => lower.includes(n));
                  return (
                    <>
                      {hasGps && <p>Latitude/Longitude → coordenadas GPS | speed → m/s | heading | altitude</p>}
                      {hasAcc && <p>acc_x, acc_y, acc_z → acelerómetro (3 ejes)</p>}
                      <p className="text-primary/80 font-medium mt-1">
                        {hasGps && hasAcc && "Cada fila GPS genera 1 registro GPS + 1 registro de acelerómetro"}
                        {hasGps && !hasAcc && "Cada fila genera 1 registro GPS"}
                        {!hasGps && hasAcc && "Cada fila genera 1 registro de acelerómetro"}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    {preview.headers.map((h, i) => (
                      <TableHead key={i} className="text-xs whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, ri) => (
                    <TableRow key={ri}>
                      {row.map((cell, ci) => (
                        <TableCell key={ci} className="text-xs whitespace-nowrap max-w-[200px] truncate">{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
              <p className="text-xs text-muted-foreground">
                {preview.totalRows.toLocaleString()} filas totales — {preview.headers.length} columnas detectadas
              </p>
              <Button
                onClick={handleUpload}
                disabled={uploading || !activeStudyId || files.length !== 1}
                data-testid="button-import"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Importar {preview.totalRows.toLocaleString()} registros
                    {effectiveFormat === "ornitella" && " (GPS + acelerómetro)"}
                  </>
                )}
              </Button>
            </div>

            {uploading && (
              <Progress value={progress} className="h-2" />
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-semibold text-foreground">Importacion completada</h3>
              {result.format && (
                <Badge variant="outline">{FORMAT_LABELS[result.format] || result.format}</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-imported-count">
                  {result.imported.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">GPS importados</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-duplicate-count">
                  {result.duplicates.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">GPS duplicados</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-error-count">
                  {result.errors.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Errores</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-individual-count">
                  {result.individuals}
                </p>
                <p className="text-xs text-muted-foreground">Individuos</p>
              </div>
            </div>

            {result.format === "ornitella" && (
              <>
                {result.ornitela_subformat && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border">
                    <Info className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-xs text-muted-foreground" data-testid="text-ornitela-subformat">
                      Sub-formato detectado: <span className="font-medium text-foreground">{result.ornitela_subformat}</span>
                      {result.gpsRows !== undefined && result.sensorsRows !== undefined && (
                        <span> — {result.gpsRows.toLocaleString()} filas GPS, {result.sensorsRows.toLocaleString()} filas sensores</span>
                      )}
                    </p>
                  </div>
                )}
                {result.accImported !== undefined && (result.accImported > 0 || (result.accDuplicates ?? 0) > 0) && (
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md bg-muted/50 border text-center">
                      <p className="text-2xl font-bold text-foreground" data-testid="text-acc-imported-count">
                        {result.accImported.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Acelerómetro importados</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50 border text-center">
                      <p className="text-2xl font-bold text-foreground" data-testid="text-acc-duplicate-count">
                        {(result.accDuplicates ?? 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Acelerómetro duplicados</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {result.individuals_created && result.individuals_created > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border">
                <Info className="w-4 h-4 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Se crearon o actualizaron <span className="font-medium text-foreground">{result.individuals_created}</span> individuos con metadatos (especie, sexo)
                </p>
              </div>
            )}

            {result.details.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                  <p className="text-xs font-medium text-muted-foreground">Detalles de errores</p>
                </div>
                <div className="max-h-32 overflow-auto rounded-md bg-muted/30 border p-2">
                  {result.details.map((d, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{d}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {activeStudyId && (
                <>
                  <Button
                    onClick={() => navigate(`/last-positions/${activeStudyId}`)}
                    data-testid="button-view-last-positions"
                  >
                    <MapPin className="w-4 h-4 mr-2" />
                    Ver últimas posiciones
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/study/${activeStudyId}/visualize`)}
                    data-testid="button-view-data"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Visualizar datos
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/study/${activeStudyId}`)}
                    data-testid="button-view-study"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Ver estudio
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={clearFiles} data-testid="button-import-another">
                <Upload className="w-4 h-4 mr-2" />
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-3">Formatos CSV soportados</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Movebank — GPS</Badge>
                <span className="text-xs text-muted-foreground">separador coma</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">timestamp</span> — ISO 8601 o epoch ms</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">individual-local-identifier</span> — ID del animal</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">location-lat</span> — Latitud</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">location-long</span> — Longitud</p>
                <p className="text-xs text-muted-foreground/60">ground-speed, heading, height-above-ellipsoid (opcionales)</p>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Movebank — Acelerometro</Badge>
                <span className="text-xs text-muted-foreground">separador coma</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">timestamp</span> — ISO 8601 o epoch ms</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">individual-local-identifier</span> — ID del animal</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">acceleration-x/y/z</span> — Valores XYZ</p>
                <p className="text-xs text-muted-foreground/60">O accelerations-raw (formato texto)</p>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Base Lunar — GPS</Badge>
                <span className="text-xs text-muted-foreground">separador punto y coma</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">nombre</span> — Identificador del individuo</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">fecha</span> + <span className="font-medium text-foreground">hora</span> — Se combinan para generar el timestamp</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">x</span> — Longitud (WGS84)</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">y</span> — Latitud (WGS84)</p>
                <p className="text-xs text-muted-foreground/60">velocidad, curso, altitud, nombre_comun, sexo (opcionales)</p>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Ornitella — GPS + Acelerómetro</Badge>
                <span className="text-xs text-muted-foreground">separador coma</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">device_id</span> — Identificador del dispositivo (= individuo)</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">UTC_datetime</span> — Fecha/hora UTC (YYYY-MM-DD HH:MM:SS)</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Latitude</span> / <span className="font-medium text-foreground">Longitude</span> — Coordenadas GPS</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">acc_x, acc_y, acc_z</span> — Datos de acelerómetro</p>
                <p className="text-xs text-muted-foreground/60">speed_km_h (→ m/s), direction_deg, Altitude_m, temperature_C (opcionales)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
