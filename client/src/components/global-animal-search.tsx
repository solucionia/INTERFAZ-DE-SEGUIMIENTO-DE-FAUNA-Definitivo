import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Individual } from "@shared/schema";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Search, PawPrint } from "lucide-react";
import { formatAnimalLabel } from "@/lib/animal-label";

interface GlobalIndividual extends Individual {
  studyName: string;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function GlobalAnimalSearch() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: allIndividuals } = useQuery<GlobalIndividual[]>({
    queryKey: ["/api/individuals/all"],
    enabled: open,
    staleTime: 30000,
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelect = (ind: GlobalIndividual) => {
    setOpen(false);
    const animal = ind.localIdentifier;
    setLocation(
      animal
        ? `/study/${ind.studyId}/visualize?animal=${encodeURIComponent(animal)}`
        : `/study/${ind.studyId}/visualize`
    );
  };

  const studyGroups = useMemo(() => {
    if (!allIndividuals) return {};
    const groups: Record<string, GlobalIndividual[]> = {};
    for (const ind of allIndividuals) {
      if (!ind.localIdentifier) continue;
      const key = `${ind.studyId}|||${ind.studyName}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ind);
    }
    return groups;
  }, [allIndividuals]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Buscar animal en todos los estudios..."
        data-testid="input-global-search"
      />
      <CommandList>
        <CommandEmpty>Sin resultados</CommandEmpty>
        {Object.entries(studyGroups).map(([key, inds]) => {
          const [, studyName] = key.split("|||");
          return (
            <CommandGroup key={key} heading={studyName}>
              {inds.map((ind) => (
                <CommandItem
                  key={ind.id}
                  value={`${normalizeText(ind.localIdentifier || "")} ${normalizeText(ind.ornitelaName || "")} ${normalizeText(ind.nickName || "")} ${normalizeText(ind.taxonCanonicalName || "")}`}
                  onSelect={() => handleSelect(ind)}
                  className="cursor-pointer"
                  data-testid={`global-result-${ind.localIdentifier}`}
                >
                  <PawPrint className="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{formatAnimalLabel(ind)}</span>
                    {ind.taxonCanonicalName && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {ind.taxonCanonicalName}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
