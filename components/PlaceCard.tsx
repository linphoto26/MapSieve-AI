import React from 'react';
import { Place, CategoryType } from '../types';

interface PlaceCardProps {
  place: Place;
  onDelete: (id: string) => void;
  isSelected?: boolean;
  isHovered?: boolean;
  onHover?: (id: string | null) => void;
  onClick?: () => void;
  id?: string;
}

const getCategoryBadgeStyle = (cat: CategoryType) => {
  switch (cat) {
    case CategoryType.FOOD: return 'bg-orange-100 text-orange-700';
    case CategoryType.DRINK: return 'bg-rose-100 text-rose-700';
    case CategoryType.SIGHTSEEING: return 'bg-emerald-100 text-emerald-700';
    case CategoryType.SHOPPING: return 'bg-purple-100 text-purple-700';
    case CategoryType.ACTIVITY: return 'bg-blue-100 text-blue-700';
    case CategoryType.LODGING: return 'bg-cyan-100 text-cyan-700';
    default: return 'bg-slate-100 text-slate-600';
  }
};

const getPriceDisplay = (price: string) => {
  if (price === 'Free') return <span className="text-emerald-600 font-bold text-xs bg-emerald-50 px-2 py-1 rounded-md">Free</span>;
  if (price === 'Unknown') return null;
  return <span className="text-slate-400 font-medium text-xs tracking-wider">{price}</span>;
};

const renderStars = (rating: number) => {
  return (
    <div className="flex text-amber-400 items-center gap-0.5">
        <span className="text-slate-700 font-bold text-sm mr-1">{rating.toFixed(1)}</span>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 fill-current" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
    </div>
  );
};

const PlaceCard: React.FC<PlaceCardProps> = ({ place, onDelete, isSelected, isHovered, onHover, onClick, id }) => {
  const searchQuery = `${place.name} ${place.subCategory || ''} ${place.locationGuess || ''}`.trim();
  const mapsUrl = place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`確定要刪除「${place.name}」嗎？`)) {
      onDelete(place.id);
    }
  };

  return (
    <div 
      id={id}
      onClick={onClick}
      onMouseEnter={() => onHover?.(place.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`
        bg-white rounded-2xl transition-all duration-300 flex flex-col h-full relative group overflow-hidden cursor-pointer
        ${isSelected 
          ? 'ring-2 ring-primary-500 shadow-xl scale-[1.01] z-10' 
          : isHovered
            ? 'shadow-float -translate-y-1 z-10'
            : 'shadow-soft border border-slate-100 hover:border-slate-200'
        }
      `}
    >
      {/* Cover Image Area */}
      <div className="w-full h-44 overflow-hidden relative bg-slate-100">
         {place.imageUri ? (
             <img 
             src={place.imageUri} 
             alt={place.name} 
             className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
             onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
           />
         ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
               </svg>
            </div>
         )}
         
         {/* Top Overlay Gradient */}
         <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

         {/* Badges */}
         <div className="absolute top-3 left-3 flex gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase shadow-sm ${getCategoryBadgeStyle(place.category)}`}>
                {place.subCategory}
            </span>
         </div>

         {/* Action Buttons (Floating) */}
         <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            {place.websiteUri && (
                <a href={place.websiteUri} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-2 bg-white/90 backdrop-blur-sm hover:bg-white text-slate-700 rounded-full shadow-md transition-all hover:scale-110">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                </a>
            )}
            <button onClick={handleDelete} className="p-2 bg-white/90 backdrop-blur-sm hover:bg-white text-rose-500 rounded-full shadow-md transition-all hover:scale-110">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
         </div>
      </div>

      <div className="p-5 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-1">
            <h3 className={`font-bold text-lg leading-tight transition-colors ${isSelected ? 'text-primary-600' : 'text-slate-800'}`}>
                {place.name}
            </h3>
            <div className="shrink-0 pl-2">
               {renderStars(place.ratingPrediction)}
            </div>
        </div>
        
        <div className="flex items-center text-slate-500 text-xs font-medium mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1 text-slate-400">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{place.locationGuess || "地點未知"}</span>
            {place.isVerified && (
                <span className="ml-2 flex items-center text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]">
                    <svg className="w-3 h-3 mr-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                    已驗證
                </span>
            )}
        </div>

        <p className="text-slate-600 text-sm mb-4 flex-grow line-clamp-3 leading-relaxed opacity-90">
            {place.description}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-4">
            {place.tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 group-hover:bg-slate-200 transition-colors">
                #{tag}
            </span>
            ))}
        </div>
        
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-slate-50">
            {getPriceDisplay(place.priceLevel)}
            <a 
            href={mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center group/link transition-all"
            >
            View Map
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 ml-1 transform group-hover/link:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            </a>
        </div>
      </div>
    </div>
  );
};

export default PlaceCard;