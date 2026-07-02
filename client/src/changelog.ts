export const VERSION = "1.3";

export interface ChangelogSection {
  title: string;
  items: string[];
}

export const CHANGES: ChangelogSection[] = [
  {
    title: "Correcciones",
    items: [
      "Arreglada la exportación de mapas y análisis geoespacial, que se quedaba bloqueada sin generar el archivo.",
      "El PDF del visualizador ya solo muestra los eventos del animal seleccionado, no de todos los animales del estudio.",
      "Reducidos los falsos positivos del detector de \"repetición de posición\" del acelerómetro.",
      "El detector de pelea/depredación ahora detecta casos reales que antes se pasaban por alto.",
      "El visualizador de datos ya no tiene scroll interno: toda la pantalla se desplaza de forma normal.",
    ],
  },
  {
    title: "Mejoras",
    items: [
      "En pantalla completa, el acelerómetro es más grande y ahora se puede comparar con el de un segundo animal.",
      "Nueva herramienta: comparador de hasta 10 acelerómetros a la vez, disponible en el menú de Herramientas.",
      "El detector de eventos permite filtrar por tipo de evento con casillas de selección.",
      "El buscador de animal en análisis geoespacial se movió a la parte superior de la pantalla.",
      "Mejorado el sistema de enlace de nuevos estudios de Ornitela para que funcione correctamente con más de un estudio activo a la vez.",
    ],
  },
];
