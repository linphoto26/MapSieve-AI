import React, { useEffect, useRef } from 'react';
import { Place } from '../types';

// Leaflet is loaded via script tag in index.html
declare const L: any;

interface MapViewProps {
  places: Place[];
  onSelectPlace: (id: string) => void;
}

const MapView: React.FC<MapViewProps> = ({ places, onSelectPlace }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([23.5, 121], 7);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(mapInstance.current);
    }

    const map = mapInstance.current;

    // Clear existing markers
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current = [];

    const validPlaces = places.filter(p => p.coordinates && typeof p.coordinates.lat === 'number' && typeof p.coordinates.lng === 'number');
    const bounds = L.latLngBounds([]);

    validPlaces.forEach(p => {
      const marker = L.marker([p.coordinates!.lat, p.coordinates!.lng])
        .addTo(map);
        
      // Bind Popup
      marker.bindPopup(`
          <div style="font-family: -apple-system, system-ui; padding: 4px;">
            <strong style="font-size: 14px; color: #333;">${p.name}</strong><br/>
            <span style="font-size: 12px; color: #666;">${p.subCategory}</span><br/>
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + p.locationGuess)}" target="_blank" style="font-size: 11px; color: #007AFF; text-decoration: none; display: inline-block; margin-top: 4px;">開啟地圖</a>
          </div>
        `);

      // Add Click Event to Highlight Card
      marker.on('click', () => {
        onSelectPlace(p.id);
      });
      
      markersRef.current.push(marker);
      bounds.extend([p.coordinates!.lat, p.coordinates!.lng]);
    });

    if (validPlaces.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
    
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

  }, [places, onSelectPlace]);

  return (
    <div className="w-full h-96 rounded-2xl overflow-hidden shadow-mac-card border border-gray-200/50 z-0 relative">
       <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_20px_rgba(0,0,0,0.05)] z-10 rounded-2xl"></div>
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default MapView;