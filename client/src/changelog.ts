export const VERSION = "1.2";

export interface ChangelogSection {
  title: string;
  items: string[];
}

export const CHANGES: ChangelogSection[] = [
  {
    title: "Correcciones",
    items: [
      "Datos históricos recuperados: ahora están disponibles más de un año de histórico para todos los animales (antes solo aparecía desde abril).",
      "Exportar track como Shapefile ahora descarga un shapefile real con capas de puntos GPS y línea de trayectoria.",
      "Botón de exportación en pantalla completa corregido: funciona con uno y varios animales.",
      "Al abrir la pantalla completa, el mapa ahora se centra automáticamente en los datos del animal.",
      "El panel \"Controles\" minimizado ya no se mete detrás del cuadro del nombre del animal.",
      "El botón \"Análisis geoespacial\" en pantalla completa abre en una nueva pestaña.",
    ],
  },
  {
    title: "Mejoras",
    items: [
      "Detector de mortalidad: ahora muestra el nombre del animal en el mapa y en las tablas de resultados.",
      "Detector de mortalidad: dos nuevos criterios basados en acelerómetro (inmovilidad ACC consecutiva y caída Z negativa), activables como opciones independientes.",
      "Detector de eventos: nuevas alertas de \"Depredación/Pelea\" (eje Z ±200 en 4 posiciones consecutivas) y \"Riesgo caída emisor\" (eje X ±300).",
      "Acelerómetro más grande en la vista normal del visualizador.",
      "Análisis geoespacial: MCP muestra por defecto 50% y 100%; el KDE tiene ahora selector de percentiles con botones predefinidos.",
      "Análisis completo incluye ahora también los gráficos de distancia recorrida y velocidad de movimiento.",
      "Análisis geoespacial: eliminado rango rápido de 1h, añadido 14 días.",
      "Análisis geoespacial: nuevo slider de máximo de puntos para filtrar cuando hay demasiadas posiciones.",
      "Visualizador: eventos filtrados por animal seleccionado, con selector de tipo de evento.",
      "Visualizador de datos accesible desde el menú lateral de herramientas.",
    ],
  },
];
