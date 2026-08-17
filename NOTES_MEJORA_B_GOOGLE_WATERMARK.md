# Análisis — Quitar símbolos de Google del mapa exportado (Mejora B, ciclo GREFA)

Rama: `feature/alerta-emision-filtros`. Este documento es **solo análisis —
no se implementó nada**, tal como se acordó (demasiado incierto/con
implicaciones de producto para decidirlo sin GREFA y sin poder validarlo
visualmente).

## Contexto

GREFA pidió investigar si se pueden quitar los símbolos/marca de Google del
mapa al exportarlo (PNG/PDF), manteniendo el mapa interactivo en pantalla
igual que hoy. Ya se había comentado como "complejo" en ciclos anteriores.

## Cómo funciona hoy

- `shared/tileProviders.ts`: las capas "Satélite"/"Híbrido"/"Terreno" usan
  `mt1.google.com/vt/lyrs={s,y,p}` — un **endpoint no oficial** de Google
  (no la API de pago de Maps Platform, sin política pública propia).
- `client/src/components/map-layers.tsx` (líneas ~10-25): OSM ("Calle")
  solo tiene su capa estándar de mapa vectorial-rasterizado — **no tiene
  equivalente de imagen satelital ni de terreno** en este allowlist. No es
  que OSM tenga una versión "peor" de satélite: no tiene ninguna.
- El texto "Google Satellite"/"Google Hybrid"/"Google Terrain" visible en el
  mapa es la `attribution` de Leaflet — un control de texto en el DOM, no
  algo incrustado en los píxeles del tile. Sería trivial de ocultar solo en
  el export (mismo patrón `onclone` que ya usa `client/src/lib/mapExport.ts`
  para forzar modo claro).
- **No confirmado sin verlo renderizado:** si Google incrusta además una
  marca/copyright directamente en los píxeles de sus tiles de satélite a
  los niveles de zoom que usa GREFA (comportamiento típico de sus tiles de
  imagen aérea). Si existe, no se puede recortar sin editar la imagen de
  Google — sería el motivo real de la complejidad ya comentada.
- `server/tileProxy.ts`: el proxy solo reenvía tiles durante la
  exportación (nunca para el mapa interactivo normal), así que técnicamente
  SÍ hay un punto de control donde diferenciar "en pantalla" de "en export".

## Las dos únicas vías técnicas, y por qué ninguna es segura

1. **Ocultar el control de atribución de Leaflet solo en el export**
   (trivial, ~10 líneas en el `onclone` existente) — pero el resultado
   sería un PDF/PNG distribuible con imagen satelital real de Google **sin
   la atribución que sus términos exigen** para cualquier uso de sus tiles,
   oficial o no. Ocultar nuestro propio control de atribución no cambia que
   seguimos usando su contenido sin atribuirlo en un documento que sale de
   la aplicación. **Riesgo: legal/términos de servicio, no técnico.**

2. **Cambiar a OSM solo durante la exportación**, manteniendo Google en
   pantalla — soluciona la atribución (OSM la exige visible pero permite
   exportar libremente bajo su licencia), pero si el usuario tenía
   seleccionado Satélite/Híbrido/Terreno, el PDF exportado mostraría un
   mapa de calles **sin ninguna imagen aérea** — no es un recorte
   cosmético, es perder por completo el tipo de información que llevó a
   elegir esa capa (relevante en zonas de trabajo de GREFA donde la
   cobertura de calles de OSM puede ser escasa, precisamente donde más se
   valora la imagen satelital). Además requeriría cambiar la capa de
   Leaflet en vivo, esperar a que carguen los tiles OSM nuevos, capturar, y
   revertir — con riesgo real de parpadeo visible en el mapa interactivo
   del usuario durante el export.

## Recomendación

**No implementar nada por ahora.** No es solo "incierto sin poder probarlo
visualmente" — incluso pudiendo probarlo, la opción 1 no resuelve el
problema de fondo (sigue siendo contenido de Google sin atribuir en un
documento exportado) y la opción 2 tiene un coste de producto real (pérdida
de imagen satelital) que le corresponde decidir a GREFA, no algo a asumir
unilateralmente en un cambio de código.

## Si se retoma

La pregunta previa no es técnica sino de producto — habría que
preguntárselo directamente a GREFA:

> ¿Aceptáis perder la vista satelital/terreno en los PDFs exportados
> (opción 2, cambiar a OSM solo en el export), o preferís mantener el
> pequeño texto de atribución de Google visible en el export tal como está
> hoy (no tocar nada)?

Solo si responden que aceptan perder la imagen satelital en los exports
tendría sentido implementar la opción 2. La opción 1 no debería
implementarse en ningún caso salvo que se consiga un uso de Google Maps
Platform que permita legalmente omitir la atribución en el destino (fuera
del alcance de un cambio de código).
