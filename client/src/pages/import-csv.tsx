import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import type { Study } from "@shared/schema";
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
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X, Eye } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type ImportResult = {
  imported: number;
  duplicates: number;
  errors: number;
  details: string[];
  dataType: string;
  individuals: number;
};

type ParsedPreview = {
  headers: string[];
  rows: string[][];
  totalRows: number;
};

export default function ImportCsv() {
  const [, params] = useRoute("/study/:id/import");
  const preselectedStudyId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedStudyId, setSelectedStudyId] = useState<string>(preselectedStudyId || "");
  const [dataType, setDataType] = useState<"gps" | "acc">("gps");
  const [file, setFile] = useState<File | null>(null);
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

  const parsePreview = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        toast({ title: "Archivo inválido", description: "El archivo debe tener al menos una cabecera y una fila de datos", variant: "destructive" });
        return;
      }
      const separator = lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(separator).map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
      const rows: string[][] = [];
      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        rows.push(lines[i].split(separator).map((v) => v.trim().replace(/^"/, "").replace(/"$/, "")));
      }
      setPreview({ headers, rows, totalRows: lines.length - 1 });
    };
    reader.readAsText(f.slice(0, 1024 * 100));
  }, [toast]);

  const handleFileSelect = useCallback((f: File) => {
    if (f.size > 100 * 1024 * 1024) {
      toast({ title: "Archivo demasiado grande", description: "El tamaño máximo permitido es 100MB", variant: "destructive" });
      return;
    }
    if (!f.name.toLowerCase().endsWith(".csv") && !f.name.toLowerCase().endsWith(".tsv") && !f.name.toLowerCase().endsWith(".txt")) {
      toast({ title: "Formato inválido", description: "Solo se aceptan archivos CSV, TSV o TXT", variant: "destructive" });
      return;
    }
    setFile(f);
    setResult(null);
    parsePreview(f);
  }, [toast, parsePreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const handleUpload = async () => {
    if (!file || !activeStudyId) return;

    setUploading(true);
    setProgress(10);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dataType", dataType);

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

      toast({
        title: "Importación completada",
        description: `${data.imported} registros importados, ${data.duplicates} duplicados ignorados`,
      });
    } catch (e: any) {
      toast({ title: "Error al importar", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const breadcrumbs = preselectedStudyId && selectedStudy
    ? [{ label: selectedStudy.name, href: `/study/${preselectedStudyId}` }, { label: "Importar CSV" }]
    : [{ label: "Importar CSV" }];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-import-title">Importar datos CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Carga datos GPS o acelerómetro desde archivos CSV exportados de Movebank
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              >
                <SelectTrigger data-testid="select-data-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gps">GPS (sensor 653)</SelectItem>
                  <SelectItem value="acc">Acelerómetro (sensor 2365683)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Archivo CSV</label>
            {!file ? (
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
                  Arrastra un archivo CSV aquí o haz clic para seleccionar
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Máximo 100MB — Separador coma o tabulador
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                  data-testid="input-file"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid="text-filename">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                    {preview && ` — ${preview.totalRows.toLocaleString()} filas`}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={clearFile} data-testid="button-clear-file">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {preview && !result && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Vista previa (primeras {preview.rows.length} filas)</h3>
            </div>
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
                disabled={uploading || !activeStudyId}
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
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-semibold text-foreground">Importación completada</h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-imported-count">
                  {result.imported.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Importados</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50 border text-center">
                <p className="text-2xl font-bold text-foreground" data-testid="text-duplicate-count">
                  {result.duplicates.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Duplicados</p>
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
                <Button
                  variant="outline"
                  onClick={() => navigate(`/study/${activeStudyId}/visualize`)}
                  data-testid="button-view-data"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Ver datos importados
                </Button>
              )}
              <Button variant="outline" onClick={clearFile} data-testid="button-import-another">
                <Upload className="w-4 h-4 mr-2" />
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-foreground mb-3">Formato CSV esperado</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">GPS</Badge>
                <span className="text-xs text-muted-foreground">sensor_type_id 653</span>
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
                <Badge variant="outline">Acelerómetro</Badge>
                <span className="text-xs text-muted-foreground">sensor_type_id 2365683</span>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">timestamp</span> — ISO 8601 o epoch ms</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">individual-local-identifier</span> — ID del animal</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">acceleration-x/y/z</span> — Valores XYZ</p>
                <p className="text-xs text-muted-foreground/60">O accelerations-raw (formato texto)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
