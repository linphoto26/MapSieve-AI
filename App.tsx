

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeMapData, analyzeImage } from './services/geminiService';
import { AnalysisResult, CategoryType, Place } from './types';
import PlaceCard from './components/PlaceCard';
import SkeletonCard from './components/SkeletonCard';
import MapView from './components/MapView';
import ChatWidget from './components/ChatWidget';
import { generateCSV, generateKML, downloadFile } from './services/exportService';

const LOADING_MESSAGES = [
  "AI 正在閱讀您的遊記內容...",
  "正在挖掘文章中提到的隱藏景點...",
  "正在分析作者的推薦理由與評價...",
  "正在為您標記地圖座標...",
  "正在整理景點分類標籤...",
  "地圖即將生成，請稍候..."
];

const App: React.FC = () => {
  // PERSISTENCE: Initialize state from localStorage if available
  const [rawInput, setRawInput] = useState<string>(() => {
    return localStorage.getItem('mapsieve_input') || '';
  });
  
  const [result, setResult] = useState<AnalysisResult | null>(() => {
    const saved = localStorage.getItem('mapsieve_result');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse saved result", e);
      return null;
    }
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>(LOADING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);
  
  // Filter States
  const [viewMode, setViewMode] = useState<'CATEGORY' | 'LOCATION'>('CATEGORY');
  const [activeCategory, setActiveCategory] = useState<CategoryType | 'ALL'>('ALL');
  
  // Location Hierarchy States
  const [activeLocation, setActiveLocation] = useState<string>('ALL'); // Currently Selected City
  const [activeDistrict, setActiveDistrict] = useState<string>('ALL'); // Currently Selected District
  
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'PRICE_ASC' | 'RATING_DESC' | 'LOCATION_ASC' | 'SUBCATEGORY_ASC'>('DEFAULT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // State for Selection Highlight
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);

  // Export State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Back To Top State
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Mobile Bottom Sheet State
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);

  // Ref for file input
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Message rotation effect
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

  // PERSISTENCE: Save rawInput to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('mapsieve_input', rawInput);
  }, [rawInput]);

  // PERSISTENCE: Save result to localStorage whenever it changes
  useEffect(() => {
    if (result) {
      localStorage.setItem('mapsieve_result', JSON.stringify(result));
    } else {
      localStorage.removeItem('mapsieve_result');
    }
  }, [result]);

  // Scroll Detection for Back To Top
  useEffect(() => {
    const handleScroll = () => {
      if (mainContentRef.current) {
        setShowBackToTop(mainContentRef.current.scrollTop > 300);
      }
    };
    const element = mainContentRef.current;
    if (element) {
      element.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (element) {
        element.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  const scrollToTop = () => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Scroll to selected card when selectedPlaceId changes
  useEffect(() => {
    if (selectedPlaceId) {
        const element = document.getElementById(`card-${selectedPlaceId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
  }, [selectedPlaceId]);

  const parseLocation = (loc: string) => {
    if (!loc) return { city: '未分類地區', district: '其他' };
    let cleaned = loc.replace(/^(台灣|臺灣|日本|南韓|韓國|泰國|越南)\s*/, '').trim();
    if (!cleaned) return { city: '未分類地區', district: '其他' };
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
        return { city: parts[0], district: parts.slice(1).join(' ') };
    }
    const cityMatch = cleaned.match(/^(.{2,}[市縣都府])(.+)$/);
    if (cityMatch) {
        return { city: cityMatch[1], district: cityMatch[2] };
    }
    return { city: cleaned, district: '市區' };
  };

  const uniqueCities = useMemo(() => {
    if (!result) return [];
    const cities = new Set<string>();
    result.places.forEach(p => {
      const { city } = parseLocation(p.locationGuess || '');
      cities.add(city);
    });
    return Array.from(cities).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [result]);

  const availableDistricts = useMemo(() => {
    if (activeLocation === 'ALL' || !result) return [];
    const districts = new Set<string>();
    result.places.forEach(p => {
        const { city, district } = parseLocation(p.locationGuess || '');
        if (city === activeLocation) {
            districts.add(district);
        }
    });
    return Array.from(districts).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [result, activeLocation]);

  const categoryLabels: Record<CategoryType, string> = {
    [CategoryType.FOOD]: "美食",
    [CategoryType.DRINK]: "飲品",
    [CategoryType.SIGHTSEEING]: "景點",
    [CategoryType.SHOPPING]: "購物",
    [CategoryType.ACTIVITY]: "活動",
    [CategoryType.LODGING]: "住宿",
    [CategoryType.OTHER]: "其他"
  };

  const handleAnalyze = async () => {
    if (!rawInput.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await analyzeMapData(rawInput);
      setResult(data);
    } catch (err: any) {
      setError(err.message || "我們無法處理此清單，請嘗試提供更清楚的內容。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const base64Data = result.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const data = await analyzeImage(base64, file.type);
        setResult(data);
    } catch (err: any) {
        setError(err.message || "圖片分析失敗。");
    } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePlace = (id: string) => {
    setResult(prev => {
      if (!prev) return null;
      return {
        ...prev,
        places: prev.places.filter(p => p.id !== id)
      };
    });
  };

  const handleReset = () => {
    setResult(null);
    setRawInput('');
    setError(null);
    setActiveCategory('ALL');
    setActiveLocation('ALL');
    setActiveDistrict('ALL');
    setViewMode('CATEGORY');
    setSearchQuery('');
    setSelectedPlaceId(null);
    setHoveredPlaceId(null);
    localStorage.removeItem('mapsieve_result');
    localStorage.removeItem('mapsieve_input');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const handleResetFilters = () => {
    setActiveCategory('ALL');
    setActiveLocation('ALL');
    setActiveDistrict('ALL');
    setSortBy('DEFAULT');
    setSearchQuery('');
  };

  const handleExportKML = () => {
    if (!result) return;
    const kml = generateKML(result);
    downloadFile(`mapsieve-export-${Date.now()}.kml`, kml, 'application/vnd.google-earth.kml+xml');
    setIsExportMenuOpen(false);
  };

  const handleExportCSV = () => {
    if (!result) return;
    const csv = generateCSV(result);
    downloadFile(`mapsieve-export-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    setIsExportMenuOpen(false);
  };

  const isFilterActive = activeCategory !== 'ALL' || 
                         activeLocation !== 'ALL' || 
                         activeDistrict !== 'ALL' || 
                         sortBy !== 'DEFAULT' || 
                         searchQuery !== '';

  const getFilteredAndSortedPlaces = () => {
    if (!result) return [];
    let filtered = result.places;
    
    if (viewMode === 'CATEGORY') {
        if (activeCategory !== 'ALL') {
            filtered = filtered.filter(p => p.category === activeCategory);
        }
    } else {
        if (activeLocation !== 'ALL') {
             filtered = filtered.filter(p => {
                const { city } = parseLocation(p.locationGuess || '');
                return city === activeLocation;
             });
             
             if (activeDistrict !== 'ALL') {
                filtered = filtered.filter(p => {
                    const { district } = parseLocation(p.locationGuess || '');
                    return district === activeDistrict;
                });
             }
        }
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.subCategory.toLowerCase().includes(query) ||
        p.tags.some(tag => tag.toLowerCase().includes(query)) ||
        (p.locationGuess || '').toLowerCase().includes(query)
      );
    }

    return filtered.sort((a, b) => {
      if (sortBy === 'RATING_DESC') return (b.ratingPrediction || 0) - (a.ratingPrediction || 0);
      if (sortBy === 'PRICE_ASC') {
        const priceMap: Record<string, number> = { 'Free': 0, '$': 1, '$$': 2, '$$$': 3, '$$$$': 4, 'Unknown': 5 };
        return priceMap[a.priceLevel] - priceMap[b.priceLevel];
      }
      if (sortBy === 'LOCATION_ASC') return (a.locationGuess || '').localeCompare(b.locationGuess || '', 'zh-TW');
      if (sortBy === 'SUBCATEGORY_ASC') return (a.subCategory || '').localeCompare(b.subCategory || '', 'zh-TW');
      return 0; 
    });
  };

  const placesToShow = getFilteredAndSortedPlaces();

  const groupedPlaces = useMemo(() => {
    if (viewMode !== 'LOCATION') return null;
    if (activeLocation !== 'ALL' && activeDistrict !== 'ALL') return null;
    const groups: Record<string, Place[]> = {};
    const groupingType = activeLocation === 'ALL' ? 'CITY' : 'DISTRICT';
    placesToShow.forEach(p => {
      const { city, district } = parseLocation(p.locationGuess || '');
      const key = groupingType === 'CITY' ? city : district;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-TW'));
    return { groups, sortedKeys, groupingType };
  }, [placesToShow, viewMode, activeLocation, activeDistrict]);

  // --- UI RENDER START ---

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 shrink-0 z-50 shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-systemBlue to-cyan-500 text-white p-1.5 rounded-lg shadow-sm">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984A1 1 0 0021 6a1 1 0 01-1-1 1 1 0 01-1 1 1 1 0 01-1 1H21" />
             </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800 tracking-tight flex items-center gap-2">
            MapSieve AI <span className="text-gray-400 font-light hidden sm:inline">|</span> <span className="text-gray-500 font-normal text-lg hidden sm:inline">遊記轉地圖</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {(result || isLoading) && (
            <>
              <div className="relative">
                <button disabled={isLoading} onClick={() => setIsExportMenuOpen(!isExportMenuOpen)} className="p-2 text-gray-500 hover:text-systemBlue hover:bg-gray-100 rounded-lg disabled:opacity-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                      <button onClick={handleExportKML} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50">匯出 KML</button>
                      <button onClick={handleExportCSV} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-green-50">匯出 CSV</button>
                  </div>
                )}
                {isExportMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>}
              </div>

              <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>
              
              <button disabled={isLoading} onClick={handleReset} className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50">重置</button>
            </>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* --- DESKTOP: Sidebar & Content --- */}
        <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0 hidden md:flex flex-col z-20">
           {/* Desktop Filter Sidebar */}
           <div className="p-4 flex flex-col h-full">
              <div className="mb-4">
                <input type="text" className="w-full bg-gray-100 border-none rounded-lg py-2 px-3 text-sm" placeholder="篩選列表..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={isLoading} />
              </div>
              <div className="bg-gray-100 p-1 rounded-lg flex mb-4">
                <button onClick={() => setViewMode('CATEGORY')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>分類</button>
                <button onClick={() => setViewMode('LOCATION')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md ${viewMode === 'LOCATION' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>地區</button>
              </div>
              {isFilterActive && <button onClick={handleResetFilters} className="w-full mb-4 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-lg">重設篩選</button>}
              
              <div className="flex-grow overflow-y-auto custom-scrollbar">
                {result ? (
                    <nav className="space-y-1">
                        {viewMode === 'CATEGORY' ? (
                            <>
                                <button onClick={() => setActiveCategory('ALL')} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${activeCategory === 'ALL' ? 'bg-blue-50 text-systemBlue font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>全部類別</button>
                                {Object.values(CategoryType).map(cat => (
                                    <button key={cat} onClick={() => setActiveCategory(cat)} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between ${activeCategory === cat ? 'bg-gray-100 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                                        <span>{categoryLabels[cat]}</span>
                                        {activeCategory === cat && <div className="w-1.5 h-1.5 rounded-full bg-systemBlue mt-2"></div>}
                                    </button>
                                ))}
                            </>
                        ) : (
                            <>
                                <button onClick={() => { setActiveLocation('ALL'); setActiveDistrict('ALL'); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${activeLocation === 'ALL' ? 'bg-blue-50 text-systemBlue font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>全部縣市</button>
                                {uniqueCities.map(city => (
                                    <button key={city} onClick={() => { setActiveLocation(city); setActiveDistrict('ALL'); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm flex justify-between ${activeLocation === city ? 'bg-gray-100 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
                                        <span>{city}</span>
                                    </button>
                                ))}
                            </>
                        )}
                    </nav>
                ) : (
                    <div className="flex items-center justify-center h-40 text-gray-400 text-xs">
                        {isLoading ? '載入中...' : '尚無資料'}
                    </div>
                )}
              </div>
           </div>
        </aside>

        {/* --- MAIN CONTENT: Split View (Desktop) / Bottom Sheet (Mobile) --- */}
        <main className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
            
            {/* 1. MAP LAYER */}
            {(result || isLoading) && (
                <div className={`
                    absolute inset-0 md:relative md:w-[40%] md:order-2 z-0
                    ${!result && !isLoading ? 'hidden md:block' : ''} 
                `}>
                    <MapView 
                        places={result ? placesToShow : []} 
                        onSelectPlace={setSelectedPlaceId}
                        onHoverPlace={setHoveredPlaceId}
                        selectedPlaceId={selectedPlaceId}
                        hoveredPlaceId={hoveredPlaceId}
                    />
                </div>
            )}

            {/* 2. LIST LAYER */}
            <div 
                ref={mainContentRef} 
                className={`
                    flex-1 bg-gray-50 
                    md:w-[60%] md:relative md:z-auto md:h-full md:order-1
                    transition-all duration-300 ease-in-out
                    ${(!result && !isLoading) ? 'h-full overflow-y-auto' : 
                      // Mobile Bottom Sheet Classes
                      `absolute bottom-0 left-0 right-0 z-30 rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] bg-white
                       flex flex-col
                       ${isBottomSheetExpanded ? 'h-[85vh]' : 'h-[35vh]'}
                       md:h-auto md:rounded-none md:shadow-none md:bg-gray-50
                      `
                    }
                `}
            >
                {/* Mobile Bottom Sheet Handle */}
                {(result || isLoading) && (
                    <div 
                        className="md:hidden flex-shrink-0 h-8 flex items-center justify-center cursor-pointer border-b border-gray-100 touch-pan-y"
                        onClick={() => setIsBottomSheetExpanded(!isBottomSheetExpanded)}
                    >
                        <div className="w-12 h-1.5 bg-gray-300 rounded-full"></div>
                    </div>
                )}

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 scroll-smooth relative">
                    
                    {/* Empty State / Dashboard */}
                    {!result && !isLoading && (
                        <div className="w-full max-w-2xl mx-auto mt-10">
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="bg-blue-100 p-2 rounded-xl">
                                        <svg className="w-6 h-6 text-systemBlue" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-gray-800">遊記轉換器</h2>
                                </div>
                                <p className="text-gray-600 mb-4">將網路遊記、部落格文章或旅遊筆記，一鍵轉換為可互動的行程地圖。AI 會自動標註文中提到的餐廳、景點與住宿。</p>
                                <textarea
                                    className="w-full h-40 p-4 text-base text-gray-800 placeholder-gray-400 bg-gray-50 border border-gray-200 focus:border-systemBlue focus:ring-2 focus:ring-blue-100 rounded-xl resize-none"
                                    placeholder="貼上部落格連結，或直接複製遊記內容貼在這裡..."
                                    value={rawInput}
                                    onChange={(e) => setRawInput(e.target.value)}
                                />
                                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 sm:flex-none text-sm font-medium text-gray-600 hover:text-systemBlue bg-white border border-gray-200 px-4 py-2.5 rounded-lg flex items-center justify-center gap-2">
                                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            上傳截圖
                                        </button>
                                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    </div>
                                    <button onClick={handleAnalyze} disabled={isLoading || !rawInput.trim()} className={`w-full sm:w-auto px-8 py-2.5 rounded-lg text-sm font-bold text-white shadow-sm transition-all ${isLoading || !rawInput.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-systemBlue hover:bg-blue-600'}`}>
                                        {isLoading ? '處理中...' : '生成地圖'}
                                    </button>
                                </div>
                                {error && <div className="mt-6 px-4 py-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
                            </div>
                        </div>
                    )}

                    {/* Initial Loading State: Skeletons + Engaging Message */}
                    {isLoading && !result && (
                        <div className="w-full max-w-7xl mx-auto flex flex-col items-center">
                            {/* Loading Status Indicator */}
                            <div className="bg-blue-50 border border-blue-100 rounded-full px-6 py-2 mb-8 flex items-center gap-3 shadow-sm animate-fade-in">
                                <div className="flex space-x-1">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                                <span className="text-sm font-bold text-blue-700">{loadingMessage}</span>
                            </div>

                            {/* Skeleton Grid */}
                            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <SkeletonCard key={i} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Result List */}
                    {result && (
                        <div className="animate-fade-in w-full max-w-7xl mx-auto">
                            
                            {/* Mobile Filters */}
                            <div className="md:hidden mb-4 space-y-2 sticky top-0 bg-white z-10 py-2 shadow-sm -mx-4 px-4">
                                <div className="flex bg-gray-100 p-1 rounded-lg">
                                    <button onClick={() => setViewMode('CATEGORY')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>分類</button>
                                    <button onClick={() => setViewMode('LOCATION')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${viewMode === 'LOCATION' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>地區</button>
                                </div>
                                {/* Simple horizontal scroller for mobile cats */}
                                <div className="flex overflow-x-auto gap-2 pb-1 hide-scrollbar">
                                    <button onClick={() => setActiveCategory('ALL')} className={`px-3 py-1 rounded-full text-xs border ${activeCategory === 'ALL' ? 'bg-black text-white' : 'bg-white text-gray-600'}`}>全部</button>
                                    {Object.values(CategoryType).map(cat => (
                                        <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap ${activeCategory === cat ? 'bg-systemBlue text-white border-systemBlue' : 'bg-white text-gray-600'}`}>{categoryLabels[cat]}</button>
                                    ))}
                                </div>
                            </div>

                            {/* Secondary Nav (Districts) */}
                            {viewMode === 'LOCATION' && activeLocation !== 'ALL' && availableDistricts.length > 0 && (
                                <div className="sticky top-0 z-20 -mx-4 px-4 pb-4 pt-2 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 mb-6 md:static md:bg-transparent md:border-none md:p-0 md:m-0 md:mb-6">
                                    <div className="flex overflow-x-auto gap-2 py-1 hide-scrollbar">
                                        <button onClick={() => setActiveDistrict('ALL')} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${activeDistrict === 'ALL' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>全部地區</button>
                                        {availableDistricts.map(dist => (
                                            <button key={dist} onClick={() => setActiveDistrict(dist)} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${activeDistrict === dist ? 'bg-systemBlue text-white border-systemBlue' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>{dist}</button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Grid */}
                            {placesToShow.length > 0 ? (
                                <>
                                    {groupedPlaces ? (
                                        <div className="space-y-8 md:space-y-12">
                                            {groupedPlaces.sortedKeys.map(key => (
                                                <div key={key}>
                                                    <div className="flex items-center gap-3 mb-4 md:mb-6 pb-2 border-b border-gray-200">
                                                        <h2 className="text-lg md:text-xl font-bold text-gray-800">{key}</h2>
                                                        <span className="bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full text-xs font-bold">{groupedPlaces.groups[key].length}</span>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                                        {groupedPlaces.groups[key].map(place => (
                                                            <PlaceCard 
                                                                key={place.id} 
                                                                id={`card-${place.id}`}
                                                                place={place} 
                                                                onDelete={handleRemovePlace}
                                                                isSelected={selectedPlaceId === place.id}
                                                                isHovered={hoveredPlaceId === place.id}
                                                                onHover={setHoveredPlaceId}
                                                                onClick={() => setSelectedPlaceId(place.id)}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 pb-12">
                                            {placesToShow.map((place) => (
                                                <PlaceCard 
                                                    key={place.id} 
                                                    id={`card-${place.id}`}
                                                    place={place} 
                                                    onDelete={handleRemovePlace}
                                                    isSelected={selectedPlaceId === place.id}
                                                    isHovered={hoveredPlaceId === place.id}
                                                    onHover={setHoveredPlaceId}
                                                    onClick={() => setSelectedPlaceId(place.id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-10 md:py-20 text-gray-400">
                                    <p>找不到符合條件的地點</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
      </div>

      {/* Floating Elements */}
      {result && <ChatWidget places={result.places} />}
      
      {/* Back To Top (Only Desktop or Expanded Sheet) */}
      {showBackToTop && (
        <button
            onClick={scrollToTop}
            className="fixed bottom-24 right-6 z-40 p-3 bg-white border border-gray-200 shadow-lg rounded-full text-gray-600 hover:text-systemBlue hover:bg-gray-50"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
        </button>
      )}

    </div>
  );
};

export default App;