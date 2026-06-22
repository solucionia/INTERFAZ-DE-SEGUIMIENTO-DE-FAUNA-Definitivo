import { useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";

const TILE_LAYERS = {
  street: {
    name: "Callejero",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    name: "Satélite",
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    attribution: "Google Satellite",
  },
  hybrid: {
    name: "Satélite + Etiquetas",
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    attribution: "Google Hybrid",
  },
  terrain: {
    name: "Terreno",
    url: "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    attribution: "Google Terrain",
  },
};

export function MapLayerControl() {
  const map = useMap();

  useEffect(() => {
    const baseLayers: Record<string, L.TileLayer> = {};

    const streetLayer = L.tileLayer(TILE_LAYERS.street.url, {
      attribution: TILE_LAYERS.street.attribution,
      crossOrigin: true,
    });

    baseLayers[TILE_LAYERS.street.name] = streetLayer;
    baseLayers[TILE_LAYERS.satellite.name] = L.tileLayer(TILE_LAYERS.satellite.url, {
      attribution: TILE_LAYERS.satellite.attribution,
      maxZoom: 20,
      crossOrigin: true,
    });
    baseLayers[TILE_LAYERS.hybrid.name] = L.tileLayer(TILE_LAYERS.hybrid.url, {
      attribution: TILE_LAYERS.hybrid.attribution,
      maxZoom: 20,
      crossOrigin: true,
    });
    baseLayers[TILE_LAYERS.terrain.name] = L.tileLayer(TILE_LAYERS.terrain.url, {
      attribution: TILE_LAYERS.terrain.attribution,
      maxZoom: 20,
      crossOrigin: true,
    });

    streetLayer.addTo(map);

    const control = L.control.layers(baseLayers, {}, { position: "topright" });
    control.addTo(map);

    return () => {
      control.remove();
      Object.values(baseLayers).forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    };
  }, [map]);

  return null;
}

export function GoogleMapsClick() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = "crosshair";

    const handleClick = (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent?.target as HTMLElement | undefined;
      if (target && (target.closest(".leaflet-interactive") || target.closest(".leaflet-popup") || target.closest(".leaflet-control"))) {
        return;
      }
      const { lat, lng } = e.latlng;
      window.open(`https://www.google.com/maps?q=${lat},${lng}&z=15`, "_blank");
    };

    map.on("click", handleClick);

    return () => {
      map.off("click", handleClick);
      container.style.cursor = "";
    };
  }, [map]);

  return null;
}

export function googleMapsLink(lat: number, lng: number, zoom = 18): string {
  return `https://www.google.com/maps?q=${lat},${lng}&z=${zoom}`;
}
