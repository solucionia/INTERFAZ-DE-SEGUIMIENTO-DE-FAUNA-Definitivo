# Guía de prueba — Filtros en Monitor de emisión (Mejora A)

Rama: `feature/alerta-emision-filtros` (no mergeada a `main`).

Esta guía existe porque el desarrollo se hizo sin poder probar visualmente
(sin acceso a la VM). No asumas que algo funciona por estar aquí descrito —
verifica cada paso.

## Preparación

```bash
git fetch origin
git checkout feature/alerta-emision-filtros
git pull origin feature/alerta-emision-filtros
npm install   # solo si no lo has hecho ya en esta VM
npm run dev
```

Navega a **Monitor de emisión** en el menú lateral (`/emission-monitor` o la
ruta equivalente en `App.tsx`). Necesitas que al menos un animal activo
lleve varios días sin emitir en algún estudio real, para que "Buscar"
devuelva resultados que filtrar.

**Importante:** este cambio es puramente de cliente. No toca la alerta por
email (el cron `runEmissionCheck`) — verifica que las alertas configuradas
en la sección inferior ("Alertas configuradas") siguen mostrándose y
funcionando exactamente igual que antes; no deben verse afectadas.

## Qué cambió

Tras pulsar "Buscar", aparece una fila de filtros (Estudio / Proyecto /
Ejemplar) justo encima de la tabla de resultados. Filtran la tabla en el
propio navegador — no vuelven a consultar al servidor.

## Casos a probar

### 1. Filtro por estudio

1. Ejecuta una búsqueda con resultados de **al menos 2 estudios distintos**.
2. En el desplegable "Estudio", confirma que solo aparecen los estudios que
   realmente tienen animales silenciosos en este resultado (no todos los
   estudios de la plataforma).
3. Selecciona uno — la tabla debe reducirse a solo las filas de ese estudio.
4. Vuelve a "Todos los estudios" — la tabla debe mostrar de nuevo todas las
   filas originales.

### 2. Filtro por proyecto

1. El desplegable "Proyecto" **solo debe aparecer si al menos uno de los
   animales de los resultados tiene un proyecto asignado** (`projectId` no
   nulo) — si ningún resultado tiene proyecto, el desplegable no debe
   renderizarse en absoluto.
2. Si aparece, selecciona un proyecto — la tabla debe reducirse a los
   animales de ese proyecto (verifica cruzando con la ficha del animal en
   `study-detail.tsx` si tienes dudas de a qué proyecto pertenece).

### 3. Filtro por ejemplar

1. Abre el desplegable "Ejemplar" (mismo componente `AnimalSearch` que ya
   usas en el visualizador/comparador). **Debe listar únicamente los
   animales que aparecen en los resultados actuales** — no todos los
   individuos de la plataforma.
2. Selecciona uno o varios — la tabla debe reducirse a esos animales
   exactos.
3. Confirma que puedes seleccionar varios a la vez (es multi-selección).

### 4. Combinación de filtros

Aplica estudio + proyecto + ejemplar a la vez. La tabla debe mostrar solo
las filas que cumplen **todas** las condiciones simultáneamente (AND, no
OR).

### 5. Sin resultados tras filtrar

Aplica una combinación de filtros que no deje ninguna fila (p. ej. un
estudio y un ejemplar que no coincidan). **Esperado:** un mensaje "Ningún
resultado coincide con los filtros aplicados" — distinto del mensaje
original "Todos los animales activos han emitido..." (ese es para cuando
la búsqueda en sí no encuentra ningún animal silencioso, no para cuando los
filtros ocultan resultados que sí existen).

### 6. Los filtros se resetean en cada nueva búsqueda

1. Aplica algún filtro.
2. Cambia el valor de "Días sin emitir" y pulsa "Buscar" de nuevo.
3. **Esperado:** los tres filtros vuelven a "Todos" / vacío automáticamente
   — no debe quedar un filtro antiguo ocultando silenciosamente los
   resultados de la nueva búsqueda.

## Notas generales

- Solo se tocó `client/src/pages/emission-monitor.tsx`. No hay migración de
  base de datos ni cambios en `server/`.
- El cron de alertas por email (`runEmissionCheck`) sigue evaluando TODOS
  los estudios/animales accesibles del usuario dueño de cada alerta, sin
  ningún filtro — esto es intencional para este ciclo (ver el mensaje de
  commit). Si se pide acotar también el email, es un punto aparte.
