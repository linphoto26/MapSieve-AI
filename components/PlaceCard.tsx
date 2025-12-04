import React from 'react';
import { Place, CategoryType } from '../types';

interface PlaceCardProps {
  place: Place;
  onDelete: (id: string) => void;
  onAddPlace?: () => void;
  isSelected?: boolean;
  onHover?: (id: string | null) => void;
  id?: string;
}

const getCategoryStyle = (cat: CategoryType) => {
  // Using macOS system colors
  switch (cat) {
    case CategoryType.FOOD: return 'bg-systemOrange/10 text-systemOrange';
    case CategoryType.DRINK: return 'bg-systemIndigo/10 text-systemIndigo';
    case CategoryType.SIGHTSEEING: return 'bg-systemGreen/10 text-systemGreen';
    case CategoryType.SHOPPING: return 'bg-systemRed/10 text-systemRed';
    case CategoryType.ACTIVITY: return 'bg-systemBlue/10 text-systemBlue';
    case CategoryType.LODGING: return 'bg-systemTeal/10 text-systemTeal';
    default: return 'bg-gray-500/10 text-gray-500';
  }
};

const getPriceDisplay = (price: string) => {
  if (price === 'Free') return <span className="text-systemGreen font-semibold text-xs bg-systemGreen/10 px-2 py-0.5 rounded-md">免費</span>;
  if (price === 'Unknown') return null;
  return <span className="text-gray-500 font-semibold text-xs tracking-wider">{price}</span>;
};

const renderStars = (rating: number, isVerified?: boolean) => {
  return (
    <div className="flex flex-col items-end">
        <div className="flex text-systemYellow items-center space-x-0.5" title={`評分: ${rating}/5`}>
        {[...Array(5)].map((_, i) => (
            <svg key={i} xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${i < Math.round(rating) ? 'fill-current' : 'text-gray-300/50 fill-current'}`} viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
        ))}
        </div>
        {isVerified && (
            <span className="text-[9px] text-systemGreen flex items-center mt-0.5 opacity-80">
                <svg className="w-2.5 h-2.5 mr-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                Maps 已驗證
            </span>
        )}
    </div>
  );
};

const PlaceCard: React.FC<PlaceCardProps> = ({ place, onDelete, onAddPlace, isSelected, onHover, id }) => {
  // Enhanced fallback logic:
  const searchQuery = `${place.name} ${place.subCategory || ''} ${place.locationGuess || ''}`.trim();
  const mapsUrl = place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`確定要刪除「${place.name}」嗎？`)) {
      onDelete(place.id);
    }
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onAddPlace?.();
  };

  const handleMouseEnter = () => {
    onHover?.(place.id);
  };

  const handleMouseLeave = () => {
    onHover?.(null);
  };

  return (
    <div 
      id={id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        bg-white/60 backdrop-blur-md rounded-2xl border hover:shadow-lg transition-all duration-300 flex flex-col h-full relative overflow-hidden group
        ${isSelected 
          ? 'border-systemBlue ring-4 ring-systemBlue/20 shadow-mac-active scale-[1.02] z-10' 
          : 'border-white/50 shadow-mac-card'
        }
      `}
    >
      {/* Cover Image (If available from extraction) */}
      {place.imageUri && (
        <div className="w-full h-32 overflow-hidden relative bg-gray-100">
           <img 
             src={place.imageUri} 
             alt={place.name} 
             className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
             onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
           />
           <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
        </div>
      )}

      {/* Action Buttons Group - Visible by default on mobile, hover on desktop */}
      <div className="absolute top-3 right-3 flex gap-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
        {onAddPlace && (
          <button 
            onClick={handleAdd}
            className="p-1 text-gray-600 bg-white/80 hover:bg-systemBlue hover:text-white rounded-md transition-all shadow-sm backdrop-blur-sm"
            title="新增地點 (貼上 Google Maps 連結)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}

        {/* Website Link Button (If available) */}
        {place.websiteUri && (
             <a 
             href={place.websiteUri}
             target="_blank"
             rel="noopener noreferrer"
             onClick={(e) => e.stopPropagation()}
             className="p-1 text-gray-600 bg-white/80 hover:bg-systemIndigo hover:text-white rounded-md transition-all shadow-sm backdrop-blur-sm"
             title="官方網站 / 文章來源"
           >
             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
             </svg>
           </a>
        )}
        
        {/* Map Link Button */}
        <a 
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-gray-600 bg-white/80 hover:bg-systemGreen hover:text-white rounded-md transition-all shadow-sm backdrop-blur-sm"
          title="在 Google 地圖中開啟"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </a>

        <button 
          onClick={handleDelete}
          className="p-1 text-gray-600 bg-white/80 hover:bg-systemRed hover:text-white rounded-md transition-all shadow-sm backdrop-blur-sm"
          title="刪除"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-2">
            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${getCategoryStyle(place.category)}`}>
            {place.subCategory}
            </span>
            <div className="pr-4"> 
                {renderStars(place.ratingPrediction, place.isVerified)}
            </div>
        </div>

        <h3 className="font-bold text-gray-800 text-[17px] leading-tight mb-1 group-hover:text-systemBlue transition-colors">
            {place.name}
        </h3>
        
        <div className="flex items-center text-gray-500 text-[11px] mb-3 font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1 text-gray-400">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            {place.locationGuess || "地點未知"}
        </div>

        <p className="text-gray-600 text-[13px] mb-4 flex-grow line-clamp-3 leading-relaxed opacity-90">
            {place.description}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-4">
            {place.tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/50 text-gray-500 border border-black/5">
                #{tag.replace(/\s+/g, '')}
            </span>
            ))}
        </div>
        
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-black/5">
            {getPriceDisplay(place.priceLevel)}
            <a 
            href={mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-systemBlue hover:text-blue-700 transition-colors flex items-center"
            >
            {place.isVerified ? 'Google 地圖' : '搜尋地圖'}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            </a>
        </div>
      </div>
    </div>
  );
};

export default PlaceCard;