import React, { useEffect, useRef } from 'react';
import { Place, CategoryType } from '../types';

// Leaflet is loaded via script tag in index.html
declare const L: any;

interface MapViewProps {
  places: Place[];
  onSelectPlace: (id: string) => void;
  selectedPlaceId?: string | null;
  hoveredPlaceId?: string | null;
}

const getCategoryColor = (cat: CategoryType) => {
  switch (cat) {
    case CategoryType.FOOD: return '#FF9500'; // systemOrange
    case CategoryType.DRINK: return '#5856D6'; // systemIndigo
    case CategoryType.SIGHTSEEING: return '#34C759'; // systemGreen
    case CategoryType.SHOPPING: return '#FF3B30'; // systemRed
    case CategoryType.ACTIVITY: return '#007AFF'; // systemBlue
    case CategoryType.LODGING: return '#5AC8FA'; // systemTeal
    default: return '#8E8E93'; // systemGray
  }
};

const MapView: React.FC<MapViewProps> = ({ places, onSelectPlace, selectedPlaceId, hoveredPlaceId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersMap = useRef<Map<string, any>>(new Map());

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomControl: false, // Cleaner look
      }).setView([23.5, 121], 7);
      
      L.control.zoom({
        position: 'bottomright'
      }).addTo(mapInstance.current);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(mapInstance.current);
    }
  }, []);

  // Update Markers
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Remove old markers
    markersMap.current.forEach((marker) => map.removeLayer(marker));
    markersMap.current.clear();

    // Strict validation: Ensure coordinates exist AND are valid numbers (not NaN)
    const validPlaces = places.filter(p => 
        p.coordinates && 
        typeof p.coordinates.lat === 'number' && 
        typeof p.coordinates.lng === 'number' &&
        !isNaN(p.coordinates.lat) && 
        !isNaN(p.coordinates.lng)
    );
    
    const bounds = L.latLngBounds([]);

    validPlaces.forEach(p => {
      try {
        const color = getCategoryColor(p.category);
        
        const svgHtml = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#FFFFFF" stroke-width="2" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); width: 100%; height: 100%;">
              <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
            </svg>
        `;

        // Standard Icon
        const icon = L.divIcon({
          className: 'custom-pin',
          html: `<div style="width: 32px; height: 32px; transform: translate(-50%, -100%); transition: transform 0.2s ease;">${svgHtml}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32]
        });

        // Double check coords again before passing to Leaflet
        if (!isNaN(p.coordinates!.lat) && !isNaN(p.coordinates!.lng)) {
            const marker = L.marker([p.coordinates!.lat, p.coordinates!.lng], { icon: icon })
              .addTo(map);
              
            // Bind Popup
            marker.bindPopup(`
                <div style="font-family: -apple-system, system-ui; padding: 4px; min-width: 150px;">
                  <strong style="font-size: 14px; color: #333;">${p.name}</strong><br/>
                  <span style="font-size: 12px; color: ${color}; font-weight: 600;">${p.subCategory}</span><br/>
                  <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.locationGuess)}" target="_blank" style="font-size: 11px; color: #007AFF; text-decoration: none; display: inline-block; margin-top: 4px;">開啟地圖</a>
                </div>
              `);

            marker.on('click', () => {
              onSelectPlace(p.id);
            });
            
            markersMap.current.set(p.id, marker);
            bounds.extend([p.coordinates!.lat, p.coordinates!.lng]);
        }
      } catch (err) {
        console.warn("Skipping invalid marker:", p.name, err);
      }
    });

    // Only fit bounds if we have points and it's likely an initial load or reset
    // Added try-catch and isValid check for bounds
    if (validPlaces.length > 0 && !selectedPlaceId && bounds.isValid()) {
       try {
         map.fitBounds(bounds, { padding: [50, 50] });
       } catch (e) {
         console.warn("FitBounds failed:", e);
       }
    }
    
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

  }, [places]);

  // Handle Selection: FlyTo + Popup
  useEffect(() => {
    if (!selectedPlaceId) return;
    const marker = markersMap.current.get(selectedPlaceId);
    if (marker && mapInstance.current) {
        try {
            // Ensure marker has valid latlng before flying to avoid crash
            const ll = marker.getLatLng();
            if (ll && typeof ll.lat === 'number' && typeof ll.lng === 'number' && !isNaN(ll.lat) && !isNaN(ll.lng)) {
                mapInstance.current.flyTo(ll, 15, {
                    duration: 1.5,
                    easeLinearity: 0.25
                });
                marker.openPopup();
            }
        } catch (e) {
            console.warn("Map FlyTo failed:", e);
        }
    }
  }, [selectedPlaceId]);

  // Handle Hover: Highlight Marker (Z-Index)
  useEffect(() => {
    // Reset all z-indexes
    markersMap.current.forEach((m: any) => m.setZIndexOffset(0));
    
    // Highlight hovered
    if (hoveredPlaceId) {
        const marker = markersMap.current.get(hoveredPlaceId);
        if (marker) {
            marker.setZIndexOffset(1000);
        }
    }
  }, [hoveredPlaceId]);

  return (
    <div className="w-full h-96 rounded-2xl overflow-hidden shadow-mac-card border border-gray-200/50 z-0 relative group">
       <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_20px_rgba(0,0,0,0.05)] z-10 rounded-2xl"></div>
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default MapView;