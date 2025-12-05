import React, { useEffect, useRef } from 'react';
import { Place, CategoryType } from '../types';

declare const L: any;

interface MapViewProps {
  places: Place[];
  onSelectPlace: (id: string) => void;
  onHoverPlace?: (id: string | null) => void;
  selectedPlaceId?: string | null;
  hoveredPlaceId?: string | null;
}

const getCategoryColor = (cat: CategoryType) => {
  switch (cat) {
    case CategoryType.FOOD: return '#FF9500';
    case CategoryType.DRINK: return '#5856D6';
    case CategoryType.SIGHTSEEING: return '#34C759';
    case CategoryType.SHOPPING: return '#FF3B30';
    case CategoryType.ACTIVITY: return '#007AFF';
    case CategoryType.LODGING: return '#5AC8FA';
    default: return '#8E8E93';
  }
};

const validateLatLng = (lat: any, lng: any): [number, number] | null => {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (Number.isFinite(nLat) && Number.isFinite(nLng) && Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180) {
    return [nLat, nLng];
  }
  return null;
};

const MapView: React.FC<MapViewProps> = ({ places, onSelectPlace, onHoverPlace, selectedPlaceId, hoveredPlaceId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const clusterGroup = useRef<any>(null);
  const markersMap = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    if (!mapRef.current) return;
    if (!mapInstance.current) {
      try {
        mapInstance.current = L.map(mapRef.current, { zoomControl: false, tap: false }).setView([23.5, 121], 7);
        L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19
        }).addTo(mapInstance.current);

        clusterGroup.current = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 50,
            iconCreateFunction: function(cluster: any) {
                return new L.DivIcon({ 
                    html: '<div><span>' + cluster.getChildCount() + '</span></div>', 
                    className: 'marker-cluster marker-cluster-small', 
                    iconSize: new L.Point(40, 40) 
                });
            }
        });
        mapInstance.current.addLayer(clusterGroup.current);
      } catch (e) { console.error("Map init failed", e); }
    }
    return () => {
        if (mapInstance.current) {
            mapInstance.current.remove();
            mapInstance.current = null;
        }
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !clusterGroup.current) return;

    clusterGroup.current.clearLayers();
    markersMap.current.clear();
    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

    places.forEach(p => {
      const validCoords = p.coordinates ? validateLatLng(p.coordinates.lat, p.coordinates.lng) : null;
      if (!validCoords) return;

      const [lat, lng] = validCoords;
      const color = getCategoryColor(p.category);
      
      const svgHtml = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#FFFFFF" stroke-width="2" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); width: 100%; height: 100%;">
            <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
          </svg>
      `;

      const icon = L.divIcon({
        className: `custom-pin-${p.id}`,
        html: `<div id="pin-${p.id}" style="width: 32px; height: 32px; transform: translate(-50%, -100%); transition: transform 0.2s;">${svgHtml}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([lat, lng], { icon: icon });
      const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.locationGuess)}`;
      
      // Simplified Popup: Only Name + AI Reason + Link
      const popupHtml = `
          <div style="font-family: sans-serif; min-width: 200px; max-width: 240px; color: #374151;">
              <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 700; color: #111827;">${p.name}</h3>
              
              ${p.tags && p.tags.length > 0 ? `
                <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;">
                  ${p.tags.slice(0, 3).map(t => `<span style="font-size: 10px; background: #f3f4f6; color: #4b5563; padding: 1px 5px; border-radius: 4px;">#${t}</span>`).join('')}
                </div>
              ` : ''}

              <div style="font-size: 12px; line-height: 1.5; background: #f9fafb; padding: 8px; border-radius: 6px; border-left: 3px solid ${color}; margin-bottom: 8px;">
                  <strong style="display: block; font-size: 10px; color: #9ca3af; text-transform: uppercase;">AI 推薦理由</strong>
                  ${p.description || '無描述'}
              </div>

              <a href="${mapsUrl}" target="_blank" style="display: block; text-align: right; font-size: 11px; color: #2563EB; text-decoration: none; font-weight: 600;">
                  在 Google 地圖查看 &rarr;
              </a>
          </div>
      `;
            
      marker.bindPopup(popupHtml, { closeButton: false });
      marker.on('click', () => onSelectPlace(p.id));
      marker.on('mouseover', () => onHoverPlace?.(p.id));
      marker.on('mouseout', () => onHoverPlace?.(null));
      
      clusterGroup.current.addLayer(marker);
      markersMap.current.set(p.id, marker);
      bounds.extend([lat, lng]);
      hasValidBounds = true;
    });

    if (hasValidBounds && !selectedPlaceId) {
       try { map.fitBounds(bounds, { padding: [50, 50] }); } catch (e) {}
    }
  }, [places]);

  useEffect(() => {
    if (!selectedPlaceId || !mapInstance.current || !clusterGroup.current) return;
    const marker = markersMap.current.get(selectedPlaceId);
    if (marker) {
        clusterGroup.current.zoomToShowLayer(marker, () => {
            mapInstance.current.flyTo(marker.getLatLng(), 16, { duration: 1.0 });
            marker.openPopup();
        });
    }
  }, [selectedPlaceId]);

  useEffect(() => {
    const pin = document.getElementById(`pin-${hoveredPlaceId}`);
    if (pin) { pin.style.transform = 'translate(-50%, -100%) scale(1.5)'; pin.style.zIndex = '1000'; }
    return () => {
        if (hoveredPlaceId) {
            const prevPin = document.getElementById(`pin-${hoveredPlaceId}`);
            if (prevPin) { prevPin.style.transform = 'translate(-50%, -100%) scale(1)'; prevPin.style.zIndex = 'auto'; }
        }
    };
  }, [hoveredPlaceId]);

  return <div ref={mapRef} className="w-full h-full bg-gray-100" />;
};

export default MapView;