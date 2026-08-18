# Guía de prueba — Visualizador de datos (4 fallos GREFA)

Rama: `fix/visualizador-datos-multiples` (no mergeada a `main`).
Commits: uno por fallo (`git log --oneline main..fix/visualizador-datos-multiples`).

Esta guía existe porque el desarrollo se hizo sin poder probar visualmente
(sin acceso a la VM). No asumas que algo funciona por estar aquí descrito —
verifica cada paso.

## Preparación

```bash
git fetch origin
git checkout fix/visualizador-datos-multiples
git pull origin fix/visualizador-datos-multiples
npm install   # solo si no lo has hecho ya en esta VM
npm run dev
```

Necesitas un estudio con **al menos 2-3 animales con datos de acelerómetro
reales en el mismo rango de fechas** (idóneamente uno de los casos GRE con
emisor duplicado entre Cazorla/BonellisAndVultures, ya que también sirve para
verificar en paralelo el fix del comparador de acelerómetros de la rama
`fix/acc-comparator-study-dedup`, aunque esa es una rama distinta).

Dos pantallas están involucradas:
- **Visualizador normal**: `/study/:id/visualize`
- **Pantalla completa**: botón "Pantalla completa" desde el visualizador normal, o `/study/:id/fullscreen`

---

## Fallo A — Scroll del selector de animales no llega a "Todos"/"Ninguno"

**Dónde:** pantalla completa → panel "Controles" (esquina superior derecha) → campo "Animales".

**Antes del fix:** si el estudio tiene muchos animales, al abrir el desplegable
y hacer scroll con la rueda del ratón sobre la lista, el pie con los botones
"Todos"/"Ninguno" quedaba recortado por el borde del panel — scrollear la
lista no lo revelaba nunca.

**Pasos:**
1. Abre pantalla completa de un estudio con >15-20 animales (para forzar que
   la lista interna necesite scroll).
2. En el panel Controles, haz clic en el campo "Animales" para abrir el desplegable.
3. Pon el cursor sobre la lista de resultados y haz scroll con la rueda del ratón.
4. **Esperado:** al llegar al final de la lista, el pie con "Todos" / "Ninguno"
   (`data-testid="button-select-all-animals"` / `button-deselect-all-animals`)
   debe ser visible sin necesidad de ninguna otra acción.
5. Haz clic en "Todos" — debe seleccionar todos los animales del estudio.
   Haz clic en "Ninguno" — debe vaciar la selección.
6. Cierra el desplegable haciendo clic fuera (en el mapa, por ejemplo) —
   debe cerrarse. Vuelve a abrirlo y pulsa Escape — debe cerrarse también.
7. Selecciona un par de animales haciendo clic directamente sobre sus filas —
   confirma que el clic selecciona correctamente y **no cierra el desplegable
   por error** (esto es lo que rompería el fix de portal si el detector de
   "clic fuera" no reconociera el propio desplegable).
8. Haz scroll de la página/panel mientras el desplegable está abierto —
   debe seguir posicionado correctamente bajo el campo "Animales" (no
   debe quedar "flotando" en un sitio desconectado del input).
9. Repite el mismo campo "Animales" en el segundo selector del panel
   ("Comparar acelerómetro con 2º animal") y en el visualizador normal
   (`/study/:id/visualize`, campo "Animales" en la cabecera) — como
   regresión, confirma que ahí también sigue funcionando con normalidad
   (ese caso no estaba roto porque no vive dentro de un panel con scroll
   propio, pero usa el mismo componente).

**Si falla:** revisa `client/src/components/animal-search.tsx` — el
desplegable se renderiza ahora vía `createPortal` a `document.body`, con
posición calculada a mano (`getBoundingClientRect`). Si no se posiciona bien,
probablemente sea un problema de timing entre el `useLayoutEffect` que calcula
la posición y el primer render del portal.

---

## Fallo B — Minimizar la caja de animales seleccionados (pantalla completa)

**Dónde:** pantalla completa, recuadro flotante superior-izquierdo (nombre del
animal/estudio, fechas, contadores GPS/ACC, chips de color por animal).

**Pasos:**
1. Abre pantalla completa con 2+ animales seleccionados (para ver también los
   chips de color).
2. En el recuadro superior-izquierdo, debe aparecer un botón de minimizar
   (icono `Minimize2`, `data-testid="button-collapse-info-box"`) junto al
   nombre del animal/estudio.
3. Haz clic en él. **Esperado:** el recuadro se colapsa a una pastilla pequeña
   con icono de ubicación + icono de maximizar (`data-testid="button-expand-info-box"`),
   en la misma esquina.
4. Haz clic en la pastilla. **Esperado:** se restaura el recuadro completo,
   con toda la información (nombre, fechas, contadores, chips) intacta.
5. Confirma que este control es independiente del panel "Controles" (el de
   la esquina superior derecha, que ya tenía su propio minimizar) — minimizar
   uno no debe afectar al otro.

---

## Fallo C — Export PDF con una sección de acelerómetro por animal

**Dónde:** ambas pantallas — visualizador normal y pantalla completa, cada una
con su propio menú "Exportar" → "Informe PDF".

**Repite esta prueba en las dos pantallas por separado** (son implementaciones
independientes, no comparten código).

**Antes del fix:** con varios animales seleccionados, el PDF solo incluía
UNA gráfica de acelerómetro — la que estuviera visible en pantalla en ese
momento (un único animal, o antes del Fallo D, una mezcla combinada de todos).

**Pasos (visualizador normal, `/study/:id/visualize`):**
1. Selecciona 3+ animales con datos de acelerómetro en el mismo rango de
   fechas (verifica esto con "Cargar datos" antes de exportar — confirma en
   pantalla que el contador de "Acc" es >0 para ese rango).
2. Idealmente incluye al menos un animal SIN datos de acelerómetro en ese
   rango (para probar el caso "sin datos").
3. Exportar → Informe PDF.
4. Abre el PDF generado. **Esperado:**
   - Una sección "Acelerometro - <nombre/ID del animal>" por cada animal
     seleccionado, con su propia gráfica X/Y/Z — no la misma imagen repetida,
     ni una sola gráfica combinada.
   - El animal sin datos ACC en rango debe mostrar el texto
     "<animal>: sin datos de acelerometro en este rango" en vez de una
     gráfica vacía o un hueco.
   - Si hay muchos animales (prueba con 5+), confirma que el informe salta de
     página automáticamente cuando una sección no cabe en el espacio restante
     (no debe solaparse ni cortarse a la mitad).
5. Compara los datos de cada gráfica del PDF contra lo que se ve en pantalla
   al enfocar ese animal individualmente (Fallo D) — deben coincidir.

**Pasos (pantalla completa):** repite lo mismo desde el menú "Exportar" del
panel Controles en `/study/:id/fullscreen`.

**Si falla:** el render oculto usado para capturar cada animal vive en un
`<div style={{position: "fixed", left: "-10000px"}}>` justo al principio del
JSX de cada página (`data-testid="export-chart-<id>"`). Si una sección sale en
blanco, comprueba en las DevTools (con la app corriendo) que ese div existe en
el DOM con el ID de animal esperado y que `accData[animalId]` tiene puntos.

---

## Fallo D — Ya no existe la vista "combinado" del acelerómetro

**Dónde:** ambas pantallas.

**Pasos (visualizador normal):**
1. Selecciona 2+ animales, carga datos.
2. En la fila "Filtrar grafica:", confirma que **ya no aparece el badge
   "Todos"** — solo hay un badge por animal seleccionado.
3. Sin hacer clic en ningún badge, la gráfica de acelerómetro debe mostrar
   los datos del **primer animal de la selección** (no una mezcla de todos),
   y su badge correspondiente debe aparecer resaltado (color de fondo, no
   solo contorno) por defecto — nunca debe quedar sin ningún badge activo.
4. Haz clic en otro animal — la gráfica cambia a mostrar solo ese, y el
   resaltado del badge se mueve con él.

**Pasos (pantalla completa):** mismo comportamiento en la sección
"Acelerómetro: enfocar animal" del panel Controles — ya no debe existir el
botón "Todos" (`data-testid="button-focus-all"`, eliminado), y uno de los
botones por animal debe estar siempre resaltado por defecto.

**Regresión a vigilar:** el panel de comparación con un 2º animal
("Comparar acelerómetro con 2º animal") es una función aparte, no tocada por
este fix — debe seguir funcionando igual que antes (panel lado a lado).

---

## Notas generales

- Ninguno de los 4 fixes toca `server/`, esquema de base de datos, ni rutas
  de API — son cambios puramente de cliente (React). Si algo falla, el error
  estará en la consola del navegador, no en los logs del servidor.
- El error preexistente `server/routes.ts:2600` que aparece en `npm run check`
  no tiene relación con estos 4 fallos — está documentado aparte para la
  auditoría pendiente, no lo investigues aquí.
- Si algo no coincide con lo descrito arriba, anota el paso exacto donde
  diverge — con eso basta para retomarlo sin tener que re-explorar el código
  desde cero.
