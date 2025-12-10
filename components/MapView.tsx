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

// Modern Travel Theme Colors
const getCategoryColor = (cat: CategoryType) => {
  switch (cat) {
    case CategoryType.FOOD: return '#f97316'; // Orange
    case CategoryType.DRINK: return '#ec4899'; // Pink
    case CategoryType.SIGHTSEEING: return '#14b8a6'; // Teal (Primary)
    case CategoryType.SHOPPING: return '#8b5cf6'; // Violet
    case CategoryType.ACTIVITY: return '#3b82f6'; // Blue
    case CategoryType.LODGING: return '#06b6d4'; // Cyan
    default: return '#64748b'; // Slate
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
        // Use a cleaner, simpler map tile (CartoDB Voyager or Light)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          subdomains: 'abcd',
          maxZoom: 19
        }).addTo(mapInstance.current);

        clusterGroup.current = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 40,
            iconCreateFunction: function(cluster: any) {
                return new L.DivIcon({ 
                    html: `<div style="background:#0d9488; color:white; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-family:Inter; border:3px solid white; box-shadow:0 4px 6px rgba(0,0,0,0.1);">${cluster.getChildCount()}</div>`, 
                    className: 'marker-cluster-custom', 
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
      
      // Modern Pin Design
      const svgHtml = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2)); width: 100%; height: 100%;">
             <path d="M12 0c-4.418 0-8 3.582-8 8 0 5.018 7.132 14.896 7.429 15.296.149.201.384.319.633.319.25 0 .485-.119.634-.321.295-.402 7.304-10.293 7.304-15.294 0-4.418-3.582-8-8-8zm0 5c1.657 0 3 1.343 3 3s-1.343 3-3 3-3-1.343-3-3 1.343-3 3-3z"/>
          </svg>
      `;

      const icon = L.divIcon({
        className: `custom-pin-${p.id}`,
        html: `<div id="pin-${p.id}" style="width: 36px; height: 36px; transform: translate(-50%, -100%); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">${svgHtml}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -38]
      });

      const marker = L.marker([lat, lng], { icon: icon });
      const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.locationGuess)}`;
      
      // Modern Popup Design
      const popupHtml = `
          <div style="font-family: 'Inter', sans-serif; min-width: 220px; color: #334155;">
              <h3 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 700; color: #0f172a;">${p.name}</h3>
              
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                 <span style="font-size:10px; padding:2px 6px; border-radius:12px; background:${color}20; color:${color}; font-weight:600;">${p.subCategory}</span>
                 <span style="font-size:11px; color:#64748b;">${p.locationGuess?.split(' ')[1] || ''}</span>
              </div>

              <div style="font-size: 12px; line-height: 1.5; color: #475569; margin-bottom: 10px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                  ${p.description || '無描述'}
              </div>

              <a href="${mapsUrl}" target="_blank" style="display: block; text-align: center; font-size: 12px; background: #0f172a; color: white; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-weight: 500;">
                  開啟 Google 地圖
              </a>
          </div>
      `;
            
      marker.bindPopup(popupHtml, { closeButton: false, offset: L.point(0, -5) });
      marker.on('click', () => onSelectPlace(p.id));
      marker.on('mouseover', () => onHoverPlace?.(p.id));
      marker.on('mouseout', () => onHoverPlace?.(null));
      
      clusterGroup.current.addLayer(marker);
      markersMap.current.set(p.id, marker);
      bounds.extend([lat, lng]);
      hasValidBounds = true;
    });

    if (hasValidBounds && !selectedPlaceId) {
       try { map.fitBounds(bounds, { padding: [60, 60] }); } catch (e) {}
    }
  }, [places]);

  useEffect(() => {
    if (!selectedPlaceId || !mapInstance.current || !clusterGroup.current) return;
    const marker = markersMap.current.get(selectedPlaceId);
    if (marker) {
        clusterGroup.current.zoomToShowLayer(marker, () => {
            mapInstance.current.flyTo(marker.getLatLng(), 16, { duration: 1.2, easeLinearity: 0.25 });
            marker.openPopup();
        });
    }
  }, [selectedPlaceId]);

  useEffect(() => {
    const pin = document.getElementById(`pin-${hoveredPlaceId}`);
    if (pin) { pin.style.transform = 'translate(-50%, -100%) scale(1.3)'; pin.style.zIndex = '1000'; }
    return () => {
        if (hoveredPlaceId) {
            const prevPin = document.getElementById(`pin-${hoveredPlaceId}`);
            if (prevPin) { prevPin.style.transform = 'translate(-50%, -100%) scale(1)'; prevPin.style.zIndex = 'auto'; }
        }
    };
  }, [hoveredPlaceId]);

  return <div ref={mapRef} className="w-full h-full bg-slate-50" />;
};

export default MapView;