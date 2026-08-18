import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Individual } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, Check } from "lucide-react";
import { formatAnimalLabel, getAnimalDisplayName } from "@/lib/animal-label";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// studyName opcional: presente cuando individuals viene de /api/individuals/all
// (todos los estudios), para distinguir en el label animales que comparten
// local_identifier entre estudios distintos (mismo emisor, dos proyectos).
type IndividualWithStudy = Individual & { studyName?: string };

export interface AnimalSearchProps {
  individuals: IndividualWithStudy[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  activeIds?: Set<number | string>;
  className?: string;
  // Token de datos por animal. Por defecto es el localIdentifier (emisor actual);
  // las páginas que muestran animales transferidos (sin localIdentifier) pueden
  // devolver su id para que sigan siendo seleccionables. Devolver null los excluye.
  getKey?: (ind: Individual) => string | null;
}

export function AnimalSearch({
  individuals,
  selected,
  onChange,
  multiple = true,
  placeholder = "Buscar animal...",
  activeIds,
  className = "",
  getKey,
}: AnimalSearchProps) {
  const keyOf = useCallback(
    (ind: Individual): string | null => {
      if (getKey) return getKey(ind);
      return ind.localIdentifier && ind.localIdentifier.trim() !== ""
        ? ind.localIdentifier.trim()
        : null;
    },
    [getKey]
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Posición del dropdown calculada a mano: se renderiza vía portal a
  // document.body (ver más abajo) para no quedar recortado quando el
  // componente está anidado dentro de un ancestro con overflow/scroll propio
  // (p.ej. el panel flotante de controles en study-fullscreen.tsx) — un
  // dropdown "position: absolute" normal se recorta ahí y su pie con
  // "Todos"/"Ninguno" queda inalcanzable con scroll.
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    // capture:true para enterarse del scroll de CUALQUIER ancestro con scroll
    // propio (los eventos "scroll" no burbujean, pero sí se capturan).
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  const selectableAnimals = useMemo(() => {
    const withId = individuals.filter((i) => keyOf(i) != null);
    // Dedupe por token dentro del mismo estudio: el mismo emisor puede aparecer
    // duplicado ahí (p.ej. un stub sin metadatos + el registro real importado).
    // Nos quedamos con el registro más informativo para no mostrarlo dos veces.
    // Si dos individuos distintos comparten local_identifier pero pertenecen a
    // estudios distintos (emisor reutilizado en dos proyectos, caso confirmado
    // por GREFA), NO se fusionan: study_id forma parte de la key.
    const score = (i: Individual) =>
      (i.ornitelaName?.trim() ? 2 : 0) +
      (i.nickName?.trim() ? 1 : 0) +
      (i.taxonCanonicalName?.trim() ? 1 : 0);
    const byLocalId = new Map<string, IndividualWithStudy>();
    for (const ind of withId) {
      const key = `${keyOf(ind)!}|${ind.studyId}`;
      const current = byLocalId.get(key);
      if (!current || score(ind) > score(current)) byLocalId.set(key, ind);
    }
    // Orden alfabético estable por etiqueta ("Nombre (ID)"). Es el orden canónico
    // que también usa la navegación "Anterior/Siguiente" de la vista de pantalla
    // completa, para que ambos coincidan.
    return Array.from(byLocalId.values()).sort((a, b) =>
      formatAnimalLabel(a).localeCompare(formatAnimalLabel(b), "es", { sensitivity: "base", numeric: true })
    );
  }, [individuals, keyOf]);

  const filtered = useMemo(() => {
    if (!query.trim()) return selectableAnimals;
    const norm = normalizeText(query.trim());
    return selectableAnimals.filter((ind) => {
      const fields = [
        ind.localIdentifier || "",
        ind.nickName || "",
        ind.ornitelaName || "",
        ind.taxonCanonicalName || "",
      ];
      return fields.some((f) => normalizeText(f).includes(norm));
    });
  }, [selectableAnimals, query]);

  const handleSelect = useCallback(
    (localId: string) => {
      if (multiple) {
        if (selected.includes(localId)) {
          onChange(selected.filter((s) => s !== localId));
        } else {
          onChange([...selected, localId]);
        }
      } else {
        onChange([localId]);
        setOpen(false);
        setQuery("");
      }
    },
    [multiple, selected, onChange]
  );

  const handleRemove = useCallback(
    (localId: string) => {
      onChange(selected.filter((s) => s !== localId));
    },
    [selected, onChange]
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // El dropdown se porta a document.body (ver dropdownRef más abajo), así
      // que ya no es descendiente de containerRef: hay que comprobar los dos
      // para no cerrarlo al hacer clic dentro de sus propias opciones.
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open]);

  const isActive = (ind: Individual) => {
    if (!activeIds) return null;
    return activeIds.has(ind.movebankId);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pl-8"
          data-testid="input-animal-search"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 rounded-md border bg-popover shadow-md"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          data-testid="dropdown-animal-results"
        >
          <div className="max-h-[300px] overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                Sin resultados
              </div>
            ) : (
              <div className="p-1">
                {filtered.slice(0, 100).map((ind) => {
                  const localId = keyOf(ind)!;
                  const isSelected = selected.includes(localId);
                  const active = isActive(ind);
                  return (
                    <button
                      key={ind.id}
                      type="button"
                      onClick={() => handleSelect(localId)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-sm text-sm hover-elevate cursor-pointer"
                      data-testid={`option-animal-${localId}`}
                    >
                      {multiple && (
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                      )}
                      {active !== null && (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            active ? "bg-emerald-500" : "bg-muted-foreground/40"
                          }`}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium truncate block">
                          {formatAnimalLabel(ind)}
                          {ind.studyName ? ` — ${ind.studyName}` : ""}
                        </span>
                        {(ind.nickName || ind.taxonCanonicalName) && (
                          <span className="text-xs text-muted-foreground truncate block">
                            {[
                              ind.nickName && ind.nickName !== getAnimalDisplayName(ind) ? ind.nickName : null,
                              ind.taxonCanonicalName,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      {!multiple && isSelected && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
                {filtered.length > 100 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    +{filtered.length - 100} mas — refina la busqueda
                  </div>
                )}
              </div>
            )}
          </div>
          {multiple && (
            <div className="border-t p-1.5 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground pl-1">
                {selected.length} de {selectableAnimals.length} seleccionado(s)
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onChange(selectableAnimals.map((i) => keyOf(i)!))}
                  className="text-xs px-2 py-1 rounded hover-elevate text-foreground"
                  data-testid="button-select-all-animals"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-xs px-2 py-1 rounded hover-elevate text-foreground"
                  data-testid="button-deselect-all-animals"
                >
                  Ninguno
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5" data-testid="container-selected-animals">
          {selected.map((localId) => {
            const ind = selectableAnimals.find((i) => keyOf(i) === localId);
            return (
            <Badge
              key={localId}
              variant="secondary"
              className="gap-1 text-xs"
              data-testid={`chip-animal-${localId}`}
            >
              {ind ? `${formatAnimalLabel(ind)}${ind.studyName ? ` — ${ind.studyName}` : ""}` : localId}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(localId);
                }}
                className="ml-0.5 hover:text-destructive"
                data-testid={`button-remove-animal-${localId}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
