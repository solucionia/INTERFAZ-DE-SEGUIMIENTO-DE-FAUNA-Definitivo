import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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

export interface AnimalSearchProps {
  individuals: Individual[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  activeIds?: Set<number | string>;
  className?: string;
}

export function AnimalSearch({
  individuals,
  selected,
  onChange,
  multiple = true,
  placeholder = "Buscar animal...",
  activeIds,
  className = "",
}: AnimalSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectableAnimals = useMemo(
    () => individuals.filter((i) => i.localIdentifier && i.localIdentifier.trim() !== ""),
    [individuals]
  );

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md" data-testid="dropdown-animal-results">
          <div className="max-h-[300px] overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                Sin resultados
              </div>
            ) : (
              <div className="p-1">
                {filtered.slice(0, 100).map((ind) => {
                  const localId = ind.localIdentifier!;
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
                        <span className="font-medium truncate block">{formatAnimalLabel(ind)}</span>
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
                  onClick={() => onChange(selectableAnimals.map((i) => i.localIdentifier!))}
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
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5" data-testid="container-selected-animals">
          {selected.map((localId) => {
            const ind = selectableAnimals.find((i) => i.localIdentifier === localId);
            return (
            <Badge
              key={localId}
              variant="secondary"
              className="gap-1 text-xs"
              data-testid={`chip-animal-${localId}`}
            >
              {ind ? formatAnimalLabel(ind) : localId}
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
