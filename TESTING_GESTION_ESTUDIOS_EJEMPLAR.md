# Guía de prueba — Columna "Ejemplar" en Gestionar estudios (admin)

Rama: `fix/gestion-estudios-columna-nombre` (no mergeada a `main`).

Esta guía existe porque el desarrollo se hizo sin poder probar visualmente
(sin acceso a la VM). No asumas que algo funciona por estar aquí descrito —
verifica cada paso.

## Preparación

```bash
git fetch origin
git checkout fix/gestion-estudios-columna-nombre
git pull origin fix/gestion-estudios-columna-nombre
npm install   # solo si no lo has hecho ya en esta VM
npm run dev
```

Necesitas iniciar sesión como **superuser** (la ruta `/admin/studies` y el
endpoint `GET /api/sftp/unassigned` están gateados con `requireSuperuser`).

Navega a `/admin/studies` y baja hasta la tarjeta **"Archivos SFTP sin
asignar"** (solo aparece si hay al menos un archivo pendiente — si no hay
ninguno, el componente no renderiza nada, ver "Si no ves nada" más abajo).

---

## Qué cambió

Nueva columna **"Ejemplar"** entre "Device ID" y "Archivo" en la tabla de
archivos SFTP sin asignar. Para cada fila, busca si el `deviceId` de ese
archivo coincide con el `local_identifier` de algún individuo **en cualquier
estudio** (no solo en el estudio al que se va a asignar ahora) y muestra ese
histórico como ayuda para decidir a qué estudio asignarlo.

## Casos a probar

### 1. Device ID sin ningún individuo histórico (nunca visto)

**Esperado:** columna "Ejemplar" muestra un guion `—`, sin ningún icono de
aviso (este caso es "emisor nunca visto", distinto de "individuo sin
nombre" — no debe mostrar el triángulo ámbar).

### 2. Device ID que coincide con un individuo CON nombre en otro estudio

Necesitas un archivo sin asignar cuyo `deviceId` coincida con el
`local_identifier` de un individuo ya existente (con `ornitelaName` o
`nickName`) en cualquier estudio — por ejemplo, reutilizando un emisor de un
estudio ya migrado, o creando manualmente una fila de prueba en
`unassigned_sftp_files` con un `device_id` que ya exista en `individuals`.

**Esperado:**
- Se muestra el nombre resuelto por `getAnimalDisplayName` (mismo formato que
  en el resto de la app: nombre Ornitela o apodo, según cuál esté disponible),
  seguido de `(NombreDelEstudio)` entre paréntesis.
- Si ese mismo emisor coincide con individuos en **más de un estudio**
  (el caso GRE/Cazorla/BonellisAndVultures: mismo emisor, dos proyectos a la
  vez), deben aparecer **todas** las coincidencias, una por línea, cada una
  con su propio nombre de estudio — no debe colapsarse en una sola.

### 3. Device ID que coincide con un individuo SIN nombre en otro estudio

Usa un `deviceId` que coincida con un individuo que no tenga ni
`ornitelaName` ni `nickName` (el caso Cazorla-antes-del-sync que vimos hoy).

**Esperado:**
- Aparece el icono de aviso ámbar (`AlertTriangle`, mismo icono y color que
  ya existe en la tabla de individuos dentro de un estudio —
  `study-detail.tsx`, columna del nombre, `data-testid="icon-no-name-..."`).
- Al pasar el ratón por encima del icono, el tooltip debe explicar que ese
  emisor perteneció a un individuo sin nombre en otro estudio (texto distinto
  al de `study-detail.tsx`, adaptado a este contexto histórico).
- Junto al icono, el texto debe decir `(sin nombre) (NombreDelEstudio)`.

### 4. La asignación sigue funcionando igual que antes

Esta columna es solo informativa — no debe romper el flujo existente.
Selecciona un estudio en el desplegable "Asignar a estudio" y pulsa
"Asignar" para una fila cualquiera. **Esperado:** comportamiento idéntico al
que ya existía (mensaje de éxito, reprocesado de archivos, fila
desaparece/actualiza la lista) — la columna nueva no debe interferir.

### 5. Rendimiento / no debe haber N+1

No es observable directamente desde el navegador, pero si quieres
verificarlo: abre las DevTools → pestaña Network, recarga
`/admin/studies` y confirma que solo hay **una** petición a
`GET /api/sftp/unassigned` (no una por fila) — la resolución de "Ejemplar"
se hace en el servidor con una sola consulta batch, no debería generar
peticiones adicionales desde el cliente.

---

## Si no ves nada en "Archivos SFTP sin asignar"

Esa tarjeta solo se renderiza si `files.length > 0`. Si no tienes ningún
archivo pendiente de asignar en este entorno, puedes:
- Provocar uno subiendo un CSV Ornitela con un `device_id` que no esté
  registrado en ningún estudio (vía el watcher SFTP o el endpoint de sync
  manual), o
- Insertar una fila de prueba directamente en `unassigned_sftp_files` con un
  `device_id` que coincida con un `local_identifier` ya existente en
  `individuals` (para probar los casos 2 y 3 sin depender de un archivo real).

## Notas generales

- Cambios en 3 archivos: `server/storage.ts` (nuevo método de storage),
  `server/routes.ts` (enriquece `GET /api/sftp/unassigned`),
  `client/src/pages/admin-studies.tsx` (columna nueva). No se tocó el
  esquema de base de datos (`shared/schema.ts`) — no hace falta
  `npm run db:push` para probar esto.
- El error preexistente `server/routes.ts:2621` (`officialRingId`/`pvcRingId`
  faltantes) que aparece en `npm run check` no tiene relación con este fix
  — está documentado aparte para la auditoría pendiente.
- Si algo no coincide con lo descrito arriba, anota el paso exacto donde
  diverge — con eso basta para retomarlo sin tener que re-explorar el código
  desde cero.
