"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import type { RoofingOpportunity } from "@/oracle/types";

export interface MapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

interface OpportunityMapProps {
  readonly center: MapPoint;
  readonly opportunities: readonly RoofingOpportunity[];
  readonly selectedPropertyId: string | null;
  readonly onCenterChange: (center: MapPoint) => void;
  readonly onSelect: (propertyId: string) => void;
}

function ViewSync({ center }: Readonly<{ center: MapPoint }>) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.latitude, center.longitude], map.getZoom(), {
      animate: true,
    });
  }, [center, map]);
  return null;
}

function PinPlacement({ onCenterChange }: Pick<OpportunityMapProps, "onCenterChange">) {
  useMapEvents({
    click(event) {
      onCenterChange({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function pinIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: "map-marker-shell",
    html: `<span class="map-marker${selected ? " selected" : ""}"><span></span></span>`,
    iconAnchor: [16, 32],
    iconSize: [32, 32],
  });
}

export default function OpportunityMap({
  center,
  opportunities,
  selectedPropertyId,
  onCenterChange,
  onSelect,
}: OpportunityMapProps) {
  const centerIcon = useMemo(
    () =>
      L.divIcon({
        className: "search-center-shell",
        html: '<span class="search-center-marker" aria-hidden="true"></span>',
        iconAnchor: [10, 10],
        iconSize: [20, 20],
      }),
    [],
  );

  return (
    <MapContainer
      center={[center.latitude, center.longitude]}
      zoom={11}
      className="leaflet-map"
      aria-label="Pasco County opportunity map. Click to place the search pin."
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ViewSync center={center} />
      <PinPlacement onCenterChange={onCenterChange} />
      <Marker position={[center.latitude, center.longitude]} icon={centerIcon} />
      {opportunities.map(({ property }) => {
        if (property.coordinates.availability !== "available") return null;
        const selected = property.propertyId === selectedPropertyId;
        return (
          <Marker
            key={property.propertyId}
            position={[
              property.coordinates.value.latitude,
              property.coordinates.value.longitude,
            ]}
            icon={pinIcon(selected)}
            title={
              property.address.availability === "available"
                ? property.address.value
                : property.propertyId
            }
            keyboard
            eventHandlers={{ click: () => onSelect(property.propertyId) }}
            zIndexOffset={selected ? 1000 : 0}
          />
        );
      })}
    </MapContainer>
  );
}
