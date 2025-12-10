import React from 'react';

const SkeletonCard: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl border border-transparent shadow-sm flex flex-col h-full overflow-hidden animate-pulse">
      {/* Image Skeleton */}
      <div className="w-full h-44 bg-slate-200" />

      <div className="p-5 flex flex-col flex-grow space-y-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="h-6 w-2/3 bg-slate-200 rounded-md" />
          <div className="h-4 w-10 bg-slate-200 rounded-md" />
        </div>

        {/* Location */}
        <div className="flex items-center gap-2">
            <div className="h-3 w-3 bg-slate-200 rounded-full" />
            <div className="h-3 w-1/3 bg-slate-200 rounded" />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <div className="h-3 w-full bg-slate-200 rounded" />
          <div className="h-3 w-full bg-slate-200 rounded" />
          <div className="h-3 w-3/4 bg-slate-200 rounded" />
        </div>

        {/* Footer */}
        <div className="mt-auto pt-2 flex justify-between items-center">
          <div className="h-4 w-12 bg-slate-200 rounded" />
          <div className="h-4 w-20 bg-slate-200 rounded" />
        </div>
      </div>
    </div>
  );
};

export default SkeletonCard;