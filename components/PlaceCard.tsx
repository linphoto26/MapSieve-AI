import React from 'react';
import { Place, CategoryType } from '../types';

interface PlaceCardProps {
  place: Place;
  onDelete: (id: string) => void;
  onAddPlace?: () => void;
  isSelected?: boolean;
  onHover?: (id: string | null) => void;
  onClick?: () => void;
  id?: string;
}

const getCategoryStyle = (cat: CategoryType) => {
  switch (cat) {
    case CategoryType.FOOD: return 'bg-orange-50 text-orange-600 border-orange-100';
    case CategoryType.DRINK: return 'bg-indigo-50 text-indigo-600 border-indigo-100';
    case CategoryType.SIGHTSEEING: return 'bg-green-50 text-green-600 border-green-100';
    case CategoryType.SHOPPING: return 'bg-red-50 text-red-600 border-red-100';
    case CategoryType.ACTIVITY: return 'bg-blue-50 text-blue-600 border-blue-100';
    case CategoryType.LODGING: return 'bg-cyan-50 text-cyan-600 border-cyan-100';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
};

const getPriceDisplay = (price: string) => {
  if (price === 'Free') return <span className="text-green-600 font-bold text-xs bg-green-50 px-2 py-0.5 rounded">免費</span>;
  if (price === 'Unknown') return null;
  return <span className="text-gray-500 font-medium text-xs">{price}</span>;
};

const renderStars = (rating: number, isVerified?: boolean) => {
  return (
    <div className="flex flex-col items-end">
        <div className="flex text-yellow-400 items-center space-x-0.5">
        {[...Array(5)].map((_, i) => (
            <svg key={i} xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${i < Math.round(rating) ? 'fill-current' : 'text-gray-200 fill-current'}`} viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
        ))}
        </div>
        {isVerified && (
            <span className="text-[10px] text-green-600 flex items-center mt-0.5 font-medium">
                <svg className="w-3 h-3 mr-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                已驗證
            </span>
        )}
    </div>
  );
};

const PlaceCard: React.FC<PlaceCardProps> = ({ place, onDelete, onAddPlace, isSelected, onHover, onClick, id }) => {
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

  return (
    <div 
      id={id}
      onClick={onClick}
      onMouseEnter={() => onHover?.(place.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`
        bg-white rounded-xl border transition-all duration-200 flex flex-col h-full relative group overflow-hidden cursor-pointer
        ${isSelected 
          ? 'border-systemBlue ring-2 ring-blue-100 shadow-md transform scale-[1.02] z-10' 
          : 'border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }
      `}
    >
      {/* Cover Image */}
      {place.imageUri && (
        <div className="w-full h-36 overflow-hidden relative bg-gray-100 border-b border-gray-100">
           <img 
             src={place.imageUri} 
             alt={place.name} 
             className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
             onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
           />
        </div>
      )}

      {/* Action Buttons */}
      <div className="absolute top-2 right-2 flex gap-1.5 z-10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {onAddPlace && (
          <button onClick={handleAdd} className="p-1.5 bg-white text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md shadow-sm border border-gray-200" title="新增">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </button>
        )}
        {place.websiteUri && (
             <a href={place.websiteUri} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 bg-white text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md shadow-sm border border-gray-200" title="官網">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
             </a>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 bg-white text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-md shadow-sm border border-gray-200" title="Google Maps">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </a>
        <button onClick={handleDelete} className="p-1.5 bg-white text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md shadow-sm border border-gray-200" title="刪除">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${getCategoryStyle(place.category)}`}>
            {place.subCategory}
            </span>
            <div className="pl-2"> 
                {renderStars(place.ratingPrediction, place.isVerified)}
            </div>
        </div>

        <h3 className="font-bold text-gray-900 text-lg leading-tight mb-1 group-hover:text-systemBlue transition-colors">
            {place.name}
        </h3>
        
        <div className="space-y-1 mb-3">
             <div className="flex items-center text-gray-500 text-xs font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1 text-gray-400 shrink-0">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span className="truncate">{place.locationGuess || "地點未知"}</span>
             </div>
             
             {place.address && (
                 <div className="flex items-start text-gray-500 text-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1 text-gray-400 shrink-0 mt-0.5">
                       <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
                    </svg>
                    <span className="line-clamp-2">{place.address}</span>
                 </div>
             )}

             {place.openingHours && (
                 <div className="flex items-start text-gray-500 text-xs">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1 text-gray-400 shrink-0 mt-0.5">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                     </svg>
                     <span className="line-clamp-1">{place.openingHours}</span>
                 </div>
             )}
        </div>

        <p className="text-gray-600 text-sm mb-4 flex-grow line-clamp-3 leading-relaxed">
            {place.description}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-4">
            {place.tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                #{tag}
            </span>
            ))}
        </div>
        
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-gray-100">
            {getPriceDisplay(place.priceLevel)}
            <a 
            href={mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-semibold text-systemBlue hover:text-blue-700 flex items-center"
            >
            {place.isVerified ? '前往 Google Maps' : '搜尋位置'}
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