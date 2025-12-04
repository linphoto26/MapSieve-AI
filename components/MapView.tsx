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

// Ultimate Defense: Strict Validator
// Returns [lat, lng] if valid, or null if ANY part is NaN/Infinite/Missing
const validateLatLng = (lat: any, lng: any): [number, number] | null => {
  const nLat = Number(lat);
  const nLng = Number(lng);
  
  // Check strict finiteness. Leaflet explodes on NaN or Infinity.
  if (Number.isFinite(nLat) && Number.isFinite(nLng)) {
    // Basic range check (optional but good practice)
    if (Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180) {
        return [nLat, nLng];
    }
  }
  return null;
};

const MapView: React.FC<MapViewProps> = ({ places, onSelectPlace, selectedPlaceId, hoveredPlaceId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersMap = useRef<Map<string, any>>(new Map());

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstance.current) {
      try {
        mapInstance.current = L.map(mapRef.current, {
          zoomControl: false,
        }).setView([23.5, 121], 7);
        
        L.control.zoom({
          position: 'bottomright'
        }).addTo(mapInstance.current);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 19
        }).addTo(mapInstance.current);
      } catch (e) {
        console.error("Map initialization failed", e);
      }
    }
    
    // Cleanup on unmount
    return () => {
        if (mapInstance.current) {
            try {
                mapInstance.current.remove();
                mapInstance.current = null;
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    };
  }, []);

  // Update Markers
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // 1. Safe Cleanup
    markersMap.current.forEach((marker) => {
        try { map.removeLayer(marker); } catch (e) {}
    });
    markersMap.current.clear();

    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

    places.forEach(p => {
      try {
        // ULTIMATE DEFENSE: Check coordinates before doing ANYTHING
        const validCoords = p.coordinates ? validateLatLng(p.coordinates.lat, p.coordinates.lng) : null;
        
        if (!validCoords) {
            // Silently skip invalid places to prevent crash
            return; 
        }

        const [lat, lng] = validCoords;
        const color = getCategoryColor(p.category);
        
        const svgHtml = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#FFFFFF" stroke-width="2" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); width: 100%; height: 100%;">
              <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
            </svg>
        `;

        const icon = L.divIcon({
          className: 'custom-pin',
          html: `<div style="width: 32px; height: 32px; transform: translate(-50%, -100%); transition: transform 0.2s ease;">${svgHtml}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32]
        });

        const marker = L.marker([lat, lng], { icon: icon }).addTo(map);
              
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
        bounds.extend([lat, lng]);
        hasValidBounds = true;

      } catch (err) {
        // Catch-all for individual marker failure
        console.warn("Skipping marker due to error:", p.name);
      }
    });

    // 2. Safe FitBounds
    if (hasValidBounds && !selectedPlaceId) {
       try {
         if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
         }
       } catch (e) {
         console.warn("FitBounds suppressed:", e);
       }
    }
    
    // 3. Fix Layout
    setTimeout(() => {
      try { map.invalidateSize(); } catch(e) {}
    }, 200);

  }, [places]);

  // Handle Selection: FlyTo + Popup
  useEffect(() => {
    if (!selectedPlaceId || !mapInstance.current) return;
    
    const marker = markersMap.current.get(selectedPlaceId);
    if (marker) {
        try {
            const ll = marker.getLatLng();
            // ULTIMATE DEFENSE: Check coordinates again before flying
            const valid = validateLatLng(ll.lat, ll.lng);
            
            if (valid) {
                mapInstance.current.flyTo(ll, 15, {
                    duration: 1.5,
                    easeLinearity: 0.25
                });
                marker.openPopup();
            }
        } catch (e) {
            console.warn("FlyTo suppressed:", e);
        }
    }
  }, [selectedPlaceId]);

  // Handle Hover
  useEffect(() => {
    markersMap.current.forEach((m: any) => m.setZIndexOffset(0));
    
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