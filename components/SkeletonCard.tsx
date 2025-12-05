
import React from 'react';

const SkeletonCard: React.FC = () => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 flex flex-col h-full overflow-hidden animate-pulse">
      {/* Image Skeleton */}
      <div className="w-full h-36 bg-gray-200" />

      <div className="p-4 flex flex-col flex-grow space-y-3">
        {/* Header: Category & Rating */}
        <div className="flex justify-between items-start">
          <div className="h-4 w-16 bg-gray-200 rounded" />
          <div className="h-3 w-20 bg-gray-200 rounded" />
        </div>

        {/* Title */}
        <div className="h-6 w-3/4 bg-gray-200 rounded" />

        {/* Location & Details */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 bg-gray-200 rounded-full" />
            <div className="h-3 w-1/3 bg-gray-200 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 bg-gray-200 rounded-full" />
            <div className="h-3 w-1/2 bg-gray-200 rounded" />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5 pt-2">
          <div className="h-3 w-full bg-gray-200 rounded" />
          <div className="h-3 w-full bg-gray-200 rounded" />
          <div className="h-3 w-2/3 bg-gray-200 rounded" />
        </div>

        {/* Tags */}
        <div className="flex gap-2 pt-2">
          <div className="h-5 w-12 bg-gray-200 rounded" />
          <div className="h-5 w-16 bg-gray-200 rounded" />
          <div className="h-5 w-10 bg-gray-200 rounded" />
        </div>

        {/* Footer */}
        <div className="mt-auto pt-4 flex justify-between items-center border-t border-gray-50">
          <div className="h-4 w-8 bg-gray-200 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
};

export default SkeletonCard;
