
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeMapData, deduplicatePlaces } from './services/geminiService';
import { AnalysisResult, CategoryType, Place } from './types';
import PlaceCard from './components/PlaceCard';
import SkeletonCard from './components/SkeletonCard';
import MapView from './components/MapView';
import ChatWidget from './components/ChatWidget';
import ApiKeyModal from './components/ApiKeyModal';
import AddDataModal from './components/AddDataModal';
import { generateCSV, generateKML, downloadFile, shareNativeFile } from './services/exportService';

const LOADING_MESSAGES = [
  "正在探索您的遊記內容...",
  "正在發掘文中隱藏的秘境...",
  "正在分析部落客的私房推薦...",
  "正在定位地圖座標...",
  "即將完成您的專屬地圖...",
];

const App: React.FC = () => {
  // PERSISTENCE
  const [rawInput, setRawInput] = useState<string>(() => localStorage.getItem('mapsieve_input') || '');
  const [result, setResult] = useState<AnalysisResult | null>(() => {
    try {
      const saved = localStorage.getItem('mapsieve_result');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('mapsieve_api_key') || '');
  
  // MODALS
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showAddDataModal, setShowAddDataModal] = useState(false);

  // APP STATE
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(LOADING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);
  
  // FILTER & SORT
  const [viewMode, setViewMode] = useState<'CATEGORY' | 'LOCATION'>('CATEGORY');
  const [activeCategory, setActiveCategory] = useState<CategoryType | 'ALL'>('ALL');
  const [activeLocation, setActiveLocation] = useState<string>('ALL');
  const [activeDistrict, setActiveDistrict] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'PRICE_ASC' | 'RATING_DESC' | 'NAME_ASC'>('DEFAULT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // INTERACTION
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);

  // --- EFFECTS ---

  useEffect(() => {
    let interval: any;
    if (isLoading) {
      let i = 0;
      setLoadingMessage(LOADING_MESSAGES[0]);
      interval = setInterval(() => {
        i = (i + 1) % LOADING_MESSAGES.length;
        setLoadingMessage(LOADING_MESSAGES[i]);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => { localStorage.setItem('mapsieve_input', rawInput); }, [rawInput]);
  useEffect(() => { 
    if (result) localStorage.setItem('mapsieve_result', JSON.stringify(result)); 
    else localStorage.removeItem('mapsieve_result');
  }, [result]);

  const handleSaveApiKey = (key: string) => { setApiKey(key); localStorage.setItem('mapsieve_api_key', key); };

  useEffect(() => {
    const handleScroll = () => { if (mainContentRef.current) setShowBackToTop(mainContentRef.current.scrollTop > 300); };
    mainContentRef.current?.addEventListener('scroll', handleScroll);
    return () => mainContentRef.current?.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  useEffect(() => {
    if (selectedPlaceId) {
        const element = document.getElementById(`card-${selectedPlaceId}`);
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedPlaceId]);

  // --- LOGIC HELPER ---

  const parseLocation = (loc: string) => {
    if (!loc) return { city: '未分類地區', district: '其他' };
    let cleaned = loc.replace(/^(台灣|臺灣|日本|南韓|韓國|泰國|越南)\s*/, '').trim();
    if (!cleaned) return { city: '未分類地區', district: '其他' };
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) return { city: parts[0], district: parts.slice(1).join(' ') };
    const cityMatch = cleaned.match(/^(.{2,}[市縣都府])(.+)$/);
    if (cityMatch) return { city: cityMatch[1], district: cityMatch[2] };
    return { city: cleaned, district: '市區' };
  };

  const uniqueCities = useMemo(() => {
    if (!result) return [];
    const cities = new Set<string>();
    result.places.forEach(p => cities.add(parseLocation(p.locationGuess || '').city));
    return Array.from(cities).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [result]);

  const availableDistricts = useMemo(() => {
    if (activeLocation === 'ALL' || !result) return [];
    const districts = new Set<string>();
    result.places.forEach(p => {
        const { city, district } = parseLocation(p.locationGuess || '');
        if (city === activeLocation) districts.add(district);
    });
    return Array.from(districts).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [result, activeLocation]);

  const categoryLabels: Record<CategoryType, string> = {
    [CategoryType.FOOD]: "美食",
    [CategoryType.DRINK]: "咖啡/飲品",
    [CategoryType.SIGHTSEEING]: "景點",
    [CategoryType.SHOPPING]: "購物",
    [CategoryType.ACTIVITY]: "體驗活動",
    [CategoryType.LODGING]: "住宿",
    [CategoryType.OTHER]: "其他"
  };

  const handleAnalyze = async () => {
    if (!rawInput.trim()) return;
    if (!apiKey) { setShowApiKeyModal(true); return; }
    setIsLoading(true); setError(null);
    try {
      const data = await analyzeMapData(rawInput, apiKey);
      setResult(data);
    } catch (err: any) {
      setError(err.message || "處理失敗，請稍後再試。");
    } finally { setIsLoading(false); }
  };

  const handleAppendAnalyze = async (text: string) => {
    if (!text.trim()) return;
    if (!apiKey) { setShowApiKeyModal(true); return; }
    setIsLoading(true);
    try {
        const newData = await analyzeMapData(text, apiKey);
        setResult(prev => {
            if (!prev) return newData;
            const combinedPlaces = [...prev.places, ...newData.places];
            const uniquePlaces = deduplicatePlaces(combinedPlaces);
            return { ...prev, summary: prev.summary + "\n\n---\n\n" + newData.summary, places: uniquePlaces };
        });
    } catch (err: any) { throw err; } finally { setIsLoading(false); }
  };

  const handleRemovePlace = (id: string) => {
    setResult(prev => prev ? { ...prev, places: prev.places.filter(p => p.id !== id) } : null);
  };

  const handleReset = () => {
    setResult(null); setRawInput(''); setError(null); setActiveCategory('ALL');
    setActiveLocation('ALL'); setActiveDistrict('ALL'); setViewMode('CATEGORY'); setSearchQuery('');
    setSortBy('DEFAULT'); setSelectedPlaceId(null); setHoveredPlaceId(null);
    localStorage.removeItem('mapsieve_result'); localStorage.removeItem('mapsieve_input');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const handleResetFilters = () => {
    setActiveCategory('ALL'); setActiveLocation('ALL'); setActiveDistrict('ALL'); setSortBy('DEFAULT'); setSearchQuery('');
  };

  const handleExportKML = () => { if (result) { downloadFile(`mapsieve-${Date.now()}.kml`, generateKML(result), 'application/vnd.google-earth.kml+xml'); setIsExportMenuOpen(false); }};
  const handleExportCSV = () => { if (result) { downloadFile(`mapsieve-${Date.now()}.csv`, generateCSV(result), 'text/csv;charset=utf-8;'); setIsExportMenuOpen(false); }};

  const handleShare = async () => {
    if (!result) return;
    const filename = `mapsieve-guide-${Date.now()}.kml`;
    const success = await shareNativeFile(result, filename);
    if (!success) {
      // Fallback: If sharing files isn't supported (e.g. Desktop), download KML and inform user
      alert("此裝置不支援直接傳送檔案至 Apple Maps。\n\n已為您下載 KML 檔，請將檔案傳送至 iPhone/iPad 並選擇以「地圖」開啟（或建立指南）。");
      handleExportKML();
    }
  };

  const isFilterActive = activeCategory !== 'ALL' || activeLocation !== 'ALL' || activeDistrict !== 'ALL' || sortBy !== 'DEFAULT' || searchQuery !== '';

  const getFilteredAndSortedPlaces = () => {
    if (!result) return [];
    let filtered = result.places;
    if (viewMode === 'CATEGORY') {
        if (activeCategory !== 'ALL') filtered = filtered.filter(p => p.category === activeCategory);
    } else {
        if (activeLocation !== 'ALL') {
             filtered = filtered.filter(p => parseLocation(p.locationGuess || '').city === activeLocation);
             if (activeDistrict !== 'ALL') filtered = filtered.filter(p => parseLocation(p.locationGuess || '').district === activeDistrict);
        }
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(query) || p.subCategory.toLowerCase().includes(query) || p.tags.some(tag => tag.toLowerCase().includes(query)));
    }
    return filtered.sort((a, b) => {
      if (sortBy === 'RATING_DESC') return (b.ratingPrediction || 0) - (a.ratingPrediction || 0);
      if (sortBy === 'PRICE_ASC') return (a.priceLevel === 'Free' ? 0 : a.priceLevel.length) - (b.priceLevel === 'Free' ? 0 : b.priceLevel.length);
      if (sortBy === 'NAME_ASC') return a.name.localeCompare(b.name, 'zh-TW');
      return 0; 
    });
  };

  const placesToShow = getFilteredAndSortedPlaces();
  const groupedPlaces = useMemo(() => {
    if (viewMode !== 'LOCATION' || (activeLocation !== 'ALL' && activeDistrict !== 'ALL')) return null;
    const groups: Record<string, Place[]> = {};
    const groupingType = activeLocation === 'ALL' ? 'CITY' : 'DISTRICT';
    placesToShow.forEach(p => {
      const { city, district } = parseLocation(p.locationGuess || '');
      const key = groupingType === 'CITY' ? city : district;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return { groups, sortedKeys: Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-TW')), groupingType };
  }, [placesToShow, viewMode, activeLocation, activeDistrict]);

  // --- RENDER ---
  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} onSave={handleSaveApiKey} initialKey={apiKey} />
      <AddDataModal isOpen={showAddDataModal} onClose={() => setShowAddDataModal(false)} onAnalyze={handleAppendAnalyze} isLoading={isLoading} />

      {/* Modern Header */}
      <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 flex items-center justify-between px-4 sm:px-6 shrink-0 z-50 sticky top-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl shadow-lg shadow-primary-500/30 flex items-center justify-center text-white shrink-0">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor">
               <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
             </svg>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight whitespace-nowrap">
            MapSieve <span className="text-primary-600">AI</span>
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <button onClick={() => setShowApiKeyModal(true)} className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>

          {(result || isLoading) && (
            <div className="flex items-center gap-1.5 sm:gap-3">
              <button onClick={() => setShowAddDataModal(true)} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 sm:px-4 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-full text-sm font-semibold transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <span className="hidden sm:inline">新增</span>
              </button>
              
              <button disabled={isLoading} onClick={handleShare} className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:text-primary-600 hover:bg-slate-100 rounded-full transition-all text-sm font-medium group" title="分享至 Apple Maps">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="hidden lg:inline">分享指南</span>
              </button>

              <div className="relative">
                <button disabled={isLoading} onClick={() => setIsExportMenuOpen(!isExportMenuOpen)} className="p-2 text-slate-500 hover:text-primary-600 hover:bg-slate-100 rounded-full" title="匯出選項">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-xl py-2 z-50 animate-fade-in-up">
                      <button onClick={handleExportKML} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">匯出 Google Earth (KML)</button>
                      <button onClick={handleExportCSV} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">匯出 Excel (CSV)</button>
                  </div>
                )}
                {isExportMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>}
              </div>
              
              <button disabled={isLoading} onClick={handleReset} className="p-2 sm:px-4 sm:py-2 text-sm font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors" title="重置">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                <span className="hidden sm:inline">重置</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Desktop Sidebar (lg:flex) - Hidden on Tablets/Mobile */}
        <aside className="w-72 bg-white/50 backdrop-blur-sm border-r border-slate-200/60 hidden lg:flex flex-col z-20">
           <div className="p-5 flex flex-col h-full">
              <div className="mb-6 space-y-4">
                <div className="relative">
                   <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                   <input type="text" className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-400 transition-all shadow-sm placeholder:text-slate-300" placeholder="搜尋景點..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={isLoading} />
                </div>
                
                <div className="relative">
                   <select 
                      value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-3 pr-8 text-sm appearance-none cursor-pointer focus:ring-2 focus:ring-primary-100 text-slate-600 font-medium shadow-sm"
                      disabled={isLoading}
                   >
                     <option value="DEFAULT">✨ 智能推薦</option>
                     <option value="RATING_DESC">⭐ 最高評分</option>
                     <option value="PRICE_ASC">💰 最低價格</option>
                     <option value="NAME_ASC">🔤 名稱排序</option>
                   </select>
                </div>
              </div>

              <div className="bg-slate-100/80 p-1 rounded-xl flex mb-6">
                <button onClick={() => setViewMode('CATEGORY')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}>主題分類</button>
                <button onClick={() => setViewMode('LOCATION')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'LOCATION' ? 'bg-white shadow-sm text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}>地區篩選</button>
              </div>
              
              <div className="flex-grow overflow-y-auto custom-scrollbar -mr-2 pr-2">
                {result ? (
                    <nav className="space-y-1.5">
                        {viewMode === 'CATEGORY' ? (
                            <>
                                <button onClick={() => setActiveCategory('ALL')} className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all ${activeCategory === 'ALL' ? 'bg-primary-50 text-primary-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}>全部顯示</button>
                                {Object.values(CategoryType).map(cat => (
                                    <button key={cat} onClick={() => setActiveCategory(cat)} className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all group ${activeCategory === cat ? 'bg-slate-100 font-bold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                                        <span>{categoryLabels[cat]}</span>
                                        {activeCategory === cat && <div className="w-1.5 h-1.5 rounded-full bg-primary-500"></div>}
                                    </button>
                                ))}
                            </>
                        ) : (
                            <>
                                <button onClick={() => { setActiveLocation('ALL'); setActiveDistrict('ALL'); }} className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all ${activeLocation === 'ALL' ? 'bg-primary-50 text-primary-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}>全部地區</button>
                                {uniqueCities.map(city => (
                                    <button key={city} onClick={() => { setActiveLocation(city); setActiveDistrict('ALL'); }} className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all ${activeLocation === city ? 'bg-slate-100 font-bold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                                        <span>{city}</span>
                                    </button>
                                ))}
                            </>
                        )}
                    </nav>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-300 text-xs text-center px-4">
                        <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984A1 1 0 0021 6a1 1 0 01-1-1 1 1 0 01-1 1H21" /></svg>
                        <span>準備開始您的旅程</span>
                    </div>
                )}
              </div>
              
              {isFilterActive && <button onClick={handleResetFilters} className="mt-4 w-full py-2.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors">清除所有篩選</button>}
           </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 relative flex flex-col lg:flex-row overflow-hidden bg-slate-50">
            
            {/* Map Layer (Updated to use lg: for desktop split) */}
            {(result || isLoading) && (
                <div className={`absolute inset-0 lg:relative lg:w-[40%] lg:order-2 z-0 ${!result && !isLoading ? 'hidden lg:block' : ''}`}>
                    <MapView places={result ? placesToShow : []} onSelectPlace={setSelectedPlaceId} onHoverPlace={setHoveredPlaceId} selectedPlaceId={selectedPlaceId} hoveredPlaceId={hoveredPlaceId} />
                </div>
            )}

            {/* List Layer (Updated to use lg: for desktop split) */}
            <div ref={mainContentRef} className={`flex-1 lg:w-[60%] lg:relative lg:z-auto lg:h-full lg:order-1 transition-all duration-300 ease-in-out ${(!result && !isLoading) ? 'h-full overflow-y-auto' : `absolute bottom-0 left-0 right-0 z-30 rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.12)] bg-slate-50 flex flex-col ${isBottomSheetExpanded ? 'h-[85vh]' : 'h-[35vh]'} lg:h-auto lg:rounded-none lg:shadow-none lg:bg-slate-50`}`}>
                
                {/* Mobile Handle (Visible until lg) */}
                {(result || isLoading) && (
                    <div className="lg:hidden flex-shrink-0 h-8 flex items-center justify-center cursor-pointer border-b border-slate-100 touch-pan-y bg-white rounded-t-3xl" onClick={() => setIsBottomSheetExpanded(!isBottomSheetExpanded)}>
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full"></div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 scroll-smooth relative">
                    
                    {/* Empty State */}
                    {!result && !isLoading && (
                        <div className="w-full max-w-2xl mx-auto mt-12 animate-fade-in">
                            <div className="text-center mb-10">
                                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-800 mb-4 tracking-tight">
                                    將遊記文字，<br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-primary-700">轉化為您的專屬地圖</span>
                                </h1>
                                <p className="text-slate-500 text-lg max-w-lg mx-auto">
                                    貼上部落格連結或遊記內容，AI 自動為您整理景點、標籤與評價。
                                </p>
                            </div>
                            
                            <div className="bg-white rounded-3xl shadow-float border border-slate-100 p-2">
                                <textarea
                                    className="w-full h-48 p-6 text-lg text-slate-700 placeholder-slate-300 bg-transparent border-none focus:ring-0 rounded-2xl resize-none leading-relaxed"
                                    placeholder="貼上文字內容..."
                                    value={rawInput}
                                    onChange={(e) => setRawInput(e.target.value)}
                                />
                                <div className="flex justify-between items-center px-4 pb-4">
                                    <span className="text-xs font-semibold text-slate-400 bg-slate-50 px-3 py-1 rounded-full uppercase tracking-wider">MVP Version</span>
                                    <button onClick={handleAnalyze} disabled={isLoading || !rawInput.trim()} className={`px-8 py-3 rounded-xl text-base font-bold text-white shadow-lg shadow-primary-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${isLoading || !rawInput.trim() ? 'bg-slate-300 cursor-not-allowed shadow-none' : 'bg-primary-600 hover:bg-primary-500'}`}>
                                        {isLoading ? '正在分析...' : <>開始生成 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></>}
                                    </button>
                                </div>
                            </div>
                            {error && <div className="mt-6 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-sm font-medium text-center">{error}</div>}
                        </div>
                    )}

                    {/* Loading State */}
                    {isLoading && !result && (
                        <div className="w-full max-w-5xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
                            <div className="relative w-20 h-20 mb-8">
                                <span className="absolute inset-0 rounded-full border-4 border-slate-100"></span>
                                <span className="absolute inset-0 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">{loadingMessage}</h3>
                            <p className="text-slate-400">請稍候，美好的旅程即將展開</p>
                        </div>
                    )}

                    {/* Result List */}
                    {result && (
                        <div className="animate-slide-up w-full max-w-6xl mx-auto pb-20">
                            
                            {/* Mobile/Tablet Sticky Filter (Hidden on lg+) */}
                            <div className="lg:hidden mb-4 sticky top-0 bg-slate-50/95 backdrop-blur-xl z-20 py-3 -mx-4 px-4 shadow-sm border-b border-slate-200/60 transition-all">
                                {/* Row 1: Search and Sort */}
                                <div className="flex gap-2 mb-3">
                                    <div className="relative flex-1">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <input 
                                            type="text" 
                                            className="w-full bg-white border-none rounded-xl shadow-sm py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-primary-500 placeholder-slate-400 text-slate-700" 
                                            placeholder="搜尋..." 
                                            value={searchQuery} 
                                            onChange={(e) => setSearchQuery(e.target.value)} 
                                        />
                                    </div>
                                    
                                    <div className="relative shrink-0">
                                        <select 
                                            value={sortBy} 
                                            onChange={(e) => setSortBy(e.target.value as any)} 
                                            className="appearance-none bg-white border-none rounded-xl shadow-sm py-2 pl-3 pr-8 text-sm font-bold text-slate-600 focus:ring-2 focus:ring-primary-500"
                                        >
                                            <option value="DEFAULT">推薦</option>
                                            <option value="RATING_DESC">評分</option>
                                            <option value="PRICE_ASC">價格</option>
                                            <option value="NAME_ASC">名稱</option>
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Row 2: Combined Carousel (View Mode + Filters) */}
                                <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar pb-1">
                                    {/* View Mode Switcher */}
                                    <div className="flex bg-white rounded-lg p-1 shadow-sm border border-slate-100 shrink-0">
                                        <button onClick={() => setViewMode('CATEGORY')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all whitespace-nowrap ${viewMode === 'CATEGORY' ? 'bg-primary-50 text-primary-700 shadow-sm' : 'text-slate-500'}`}>主題</button>
                                        <button onClick={() => setViewMode('LOCATION')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all whitespace-nowrap ${viewMode === 'LOCATION' ? 'bg-primary-50 text-primary-700 shadow-sm' : 'text-slate-500'}`}>地區</button>
                                    </div>

                                    <div className="w-px h-5 bg-slate-300 shrink-0"></div>

                                    {/* Dynamic Chips */}
                                    {viewMode === 'CATEGORY' ? (
                                        <>
                                            <button onClick={() => setActiveCategory('ALL')} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border shadow-sm shrink-0 ${activeCategory === 'ALL' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200'}`}>全部</button>
                                            {Object.values(CategoryType).map(cat => (
                                                <button key={cat} onClick={() => setActiveCategory(activeCategory === cat ? 'ALL' : cat)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border shadow-sm shrink-0 ${activeCategory === cat ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200'}`}>{categoryLabels[cat]}</button>
                                            ))}
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => { setActiveLocation('ALL'); setActiveDistrict('ALL'); }} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border shadow-sm shrink-0 ${activeLocation === 'ALL' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200'}`}>全部地區</button>
                                            {uniqueCities.map(city => (
                                                <button key={city} onClick={() => { setActiveLocation(city); setActiveDistrict('ALL'); }} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors border shadow-sm shrink-0 ${activeLocation === city ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200'}`}>{city}</button>
                                            ))}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Responsive Grid */}
                            {placesToShow.length > 0 ? (
                                <>
                                    {groupedPlaces ? (
                                        <div className="space-y-10">
                                            {groupedPlaces.sortedKeys.map(key => (
                                                <div key={key}>
                                                    <div className="flex items-center gap-3 mb-6">
                                                        <h2 className="text-2xl font-bold text-slate-800">{key}</h2>
                                                        <div className="h-px bg-slate-200 flex-grow"></div>
                                                        <span className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-xs font-bold">{groupedPlaces.groups[key].length}</span>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                                                        {groupedPlaces.groups[key].map(place => (
                                                            <PlaceCard key={place.id} id={`card-${place.id}`} place={place} onDelete={handleRemovePlace} isSelected={selectedPlaceId === place.id} isHovered={hoveredPlaceId === place.id} onHover={setHoveredPlaceId} onClick={() => setSelectedPlaceId(place.id)} />
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                                            {placesToShow.map((place) => (
                                                <PlaceCard key={place.id} id={`card-${place.id}`} place={place} onDelete={handleRemovePlace} isSelected={selectedPlaceId === place.id} isHovered={hoveredPlaceId === place.id} onHover={setHoveredPlaceId} onClick={() => setSelectedPlaceId(place.id)} />
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                    <p>沒有找到符合條件的地點</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
      </div>
      
      {result && <ChatWidget places={result.places} apiKey={apiKey} />}
      {showBackToTop && <button onClick={scrollToTop} className="fixed bottom-24 right-6 z-40 p-3 bg-white border border-slate-100 shadow-xl rounded-full text-slate-600 hover:text-primary-600 hover:scale-110 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg></button>}
    </div>
  );
};

export default App;
