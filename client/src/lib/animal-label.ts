export interface AnimalLabelSource {
  localIdentifier?: string | null;
  individual?: string | null;
  movebankId?: number | null;
  ornitelaName?: string | null;
  nickName?: string | null;
}

export function getAnimalDisplayName(src: AnimalLabelSource | null | undefined): string | null {
  if (!src) return null;
  const name = (src.ornitelaName ?? src.nickName ?? "").trim();
  return name.length > 0 ? name : null;
}

export function getAnimalDisplayId(src: AnimalLabelSource | null | undefined): string {
  if (!src) return "";
  if (src.localIdentifier && src.localIdentifier.trim() !== "") return src.localIdentifier;
  if (src.individual && src.individual.trim() !== "") return src.individual;
  if (src.movebankId != null) return `ID-${src.movebankId}`;
  return "";
}

export function formatAnimalLabel(src: AnimalLabelSource | null | undefined): string {
  const id = getAnimalDisplayId(src);
  const name = getAnimalDisplayName(src);
  if (name && id) return `${name} (${id})`;
  return id || name || "";
}

export function formatAnimalLabelById(
  id: string,
  lookup: Map<string, AnimalLabelSource> | Record<string, AnimalLabelSource> | undefined
): string {
  if (!lookup) return id;
  const meta = lookup instanceof Map ? lookup.get(id) : lookup[id];
  if (!meta) return id;
  return formatAnimalLabel({ ...meta, localIdentifier: meta.localIdentifier ?? id });
}

export function animalMatchesSearch(src: AnimalLabelSource | null | undefined, q: string): boolean {
  if (!src) return false;
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const query = norm(q.trim());
  if (!query) return true;
  const id = getAnimalDisplayId(src);
  const name = getAnimalDisplayName(src) || "";
  return norm(id).includes(query) || norm(name).includes(query);
}
