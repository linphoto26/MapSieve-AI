import React, { useEffect, useRef } from 'react';
import { Place, CategoryType } from '../types';

// Leaflet is loaded via script tag in index.html
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

const MapView: React.FC<MapViewProps> = ({ places, onSelectPlace, onHoverPlace, selectedPlaceId, hoveredPlaceId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const clusterGroup = useRef<any>(null);
  const markersMap = useRef<Map<string, any>>(new Map());

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstance.current) {
      try {
        mapInstance.current = L.map(mapRef.current, {
          zoomControl: false,
          tap: false // Fix mobile click issues
        }).setView([23.5, 121], 7);
        
        L.control.zoom({
          position: 'bottomright'
        }).addTo(mapInstance.current);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 19
        }).addTo(mapInstance.current);

        // Initialize Cluster Group with custom settings
        clusterGroup.current = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            maxClusterRadius: 50,
            iconCreateFunction: function(cluster: any) {
                const count = cluster.getChildCount();
                // Use custom CSS classes for clusters
                return new L.DivIcon({ 
                    html: '<div><span>' + count + '</span></div>', 
                    className: 'marker-cluster marker-cluster-small', 
                    iconSize: new L.Point(40, 40) 
                });
            }
        });
        mapInstance.current.addLayer(clusterGroup.current);

      } catch (e) {
        console.error("Map initialization failed", e);
      }
    }
    
    // Cleanup on unmount
    return () => {
        if (mapInstance.current) {
            try {
                // Remove layers before removing map to prevent animation errors
                mapInstance.current.eachLayer((layer: any) => {
                    try { mapInstance.current.removeLayer(layer); } catch(e) {}
                });
                mapInstance.current.off();
                mapInstance.current.remove();
                mapInstance.current = null;
                clusterGroup.current = null;
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    };
  }, []);

  // Update Markers & Clusters
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !clusterGroup.current) return;

    // 1. Clear existing markers from cluster group and map reference
    try {
        clusterGroup.current.clearLayers();
    } catch (e) { console.warn("Clear layers failed", e); }
    markersMap.current.clear();

    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

    places.forEach(p => {
      try {
        // ULTIMATE DEFENSE: Check coordinates before doing ANYTHING
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
          html: `<div id="pin-${p.id}" style="width: 32px; height: 32px; transform: translate(-50%, -100%); transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);">${svgHtml}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32]
        });

        const marker = L.marker([lat, lng], { icon: icon });
        
        // Prepare Popup Content
        const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.locationGuess)}`;
        
        // SIMPLIFIED POPUP: Focus on "AI Reason"
        // Design:
        // 1. Name (Bold)
        // 2. Keywords (Pills) - Top 3
        // 3. AI Description (The "Reason")
        // 4. "View Details" Link
        
        const popupHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 220px; max-width: 260px; color: #1f2937;">
                <!-- Header: Name only -->
                <div style="margin-bottom: 8px;">
                   <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #111827; line-height: 1.3;">${p.name}</h3>
                   <div style="font-size: 11px; color: #6b7280; font-weight: 500;">${p.subCategory}</div>
                </div>

                <!-- Highlights/Tags (Visual Keywords) -->
                ${p.tags && p.tags.length > 0 ? `
                  <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px;">
                    ${p.tags.slice(0, 3).map(tag => `
                      <span style="font-size: 10px; font-weight: 600; color: #000; background-color: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.05);">
                        #${tag}
                      </span>
                    `).join('')}
                  </div>
                ` : ''}
                
                <!-- AI Reason (Description) -->
                <div style="
                    font-size: 12px; 
                    color: #4b5563; 
                    line-height: 1.6; 
                    margin-bottom: 12px; 
                    background: #f9fafb; 
                    padding: 8px 10px; 
                    border-radius: 8px; 
                    border-left: 3px solid ${color};
                    position: relative;
                ">
                    <span style="display: block; font-size: 10px; color: #9ca3af; font-weight: 700; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">AI 推薦理由</span>
                    ${p.description || '無詳細描述'}
                </div>
                
                <!-- Minimal Footer: Link only -->
                <div style="text-align: right; border-top: 1px solid #f3f4f6; padding-top: 8px;">
                     <a href="${mapsUrl}" target="_blank" style="display: inline-flex; align-items: center; font-size: 12px; color: #2563EB; text-decoration: none; font-weight: 600;">
                        在 Google 地圖查看
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 12px; height: 12px; margin-left: 2px;">
                          <path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                     </a>
                </div>
            </div>
        `;
              
        marker.bindPopup(popupHtml, {
             closeButton: false, // Cleaner look
             className: 'ai-popup' // We could add custom css but inline styles are safer here
        });

        marker.on('click', () => {
            onSelectPlace(p.id);
        });

        // Add hover events to markers
        marker.on('mouseover', () => {
            onHoverPlace?.(p.id);
        });
        marker.on('mouseout', () => {
            onHoverPlace?.(null);
        });
        
        // Add to Cluster Group instead of Map directly
        clusterGroup.current.addLayer(marker);
        
        markersMap.current.set(p.id, marker);
        bounds.extend([lat, lng]);
        hasValidBounds = true;

      } catch (err) {
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
    
    // 3. Invalidate size for layout correctness
    setTimeout(() => {
      try { map.invalidateSize(); } catch(e) {}
    }, 200);

  }, [places]);

  // Handle Selection: FlyTo + Popup
  useEffect(() => {
    if (!selectedPlaceId || !mapInstance.current || !clusterGroup.current) return;
    
    const marker = markersMap.current.get(selectedPlaceId);
    if (marker) {
        try {
            // Zoom to cluster if hidden
            clusterGroup.current.zoomToShowLayer(marker, () => {
                const ll = marker.getLatLng();
                const valid = validateLatLng(ll.lat, ll.lng);
                if (valid) {
                    mapInstance.current.flyTo(ll, 16, {
                        duration: 1.0,
                        easeLinearity: 0.25
                    });
                    marker.openPopup();
                }
            });
        } catch (e) {
            console.warn("ZoomToShowLayer failed:", e);
        }
    }
  }, [selectedPlaceId]);

  // Handle Hover: Scale Animation
  useEffect(() => {
    const pin = document.getElementById(`pin-${hoveredPlaceId}`);
    if (pin) {
        pin.style.transform = 'translate(-50%, -100%) scale(1.5)';
        pin.style.zIndex = '1000'; // Make sure it pops over others
    }

    return () => {
        // Cleanup scale on unhover
        if (hoveredPlaceId) {
            const prevPin = document.getElementById(`pin-${hoveredPlaceId}`);
            if (prevPin) {
                prevPin.style.transform = 'translate(-50%, -100%) scale(1)';
                prevPin.style.zIndex = 'auto';
            }
        }
    };
  }, [hoveredPlaceId]);

  return (
    <div className="w-full h-full bg-gray-100 z-0 relative group">
      <div ref={mapRef} className="w-full h-full" style={{ minHeight: '100%' }} />
    </div>
  );
};

export default MapView;