import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeMapData, analyzeImage, hasApiKey, setApiKey } from './services/geminiService';
import { AnalysisResult, CategoryType, Place, UserProfile } from './types';
import PlaceCard from './components/PlaceCard';
import MapView from './components/MapView';
import ChatWidget from './components/ChatWidget';
import { initializeFirebase, loginWithGoogle, logout, onUserChange, saveUserData, subscribeToUserData, isFirebaseInitialized, DEFAULT_FIREBASE_CONFIG } from './services/firebaseService';
import { generateCSV, generateKML, downloadFile } from './services/exportService';

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
  const [error, setError] = useState<string | null>(null);
  
  // Filter States
  const [viewMode, setViewMode] = useState<'CATEGORY' | 'LOCATION'>('CATEGORY');
  const [activeCategory, setActiveCategory] = useState<CategoryType | 'ALL'>('ALL');
  
  // Location Hierarchy States
  const [activeLocation, setActiveLocation] = useState<string>('ALL'); // Currently Selected City
  const [activeDistrict, setActiveDistrict] = useState<string>('ALL'); // Currently Selected District
  
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'PRICE_ASC' | 'RATING_DESC' | 'LOCATION_ASC' | 'SUBCATEGORY_ASC'>('DEFAULT');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // State for "Add More" feature
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addCategory, setAddCategory] = useState<CategoryType | 'AUTO'>('AUTO');

  // State for Selection Highlight
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);

  // Sync / Auth States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [firebaseConfigStr, setFirebaseConfigStr] = useState('');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // API Key Modal State
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Export State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  // Back To Top State
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Ref for file input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  
  // Debounce save timer
  const saveTimeoutRef = useRef<any>(null);

  const isUrlInput = (input: string) => input.trim().match(/^https?:\/\//i);

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

  // Check for API Key on mount
  useEffect(() => {
    if (!hasApiKey()) {
      setIsApiKeyModalOpen(true);
    }
  }, []);

  // Initialize Firebase from LocalStorage or Default Config
  useEffect(() => {
    const savedConfig = localStorage.getItem('firebase_config');
    let configToUse = DEFAULT_FIREBASE_CONFIG;

    if (savedConfig) {
      setFirebaseConfigStr(savedConfig);
      try {
        configToUse = JSON.parse(savedConfig);
      } catch (e) {
        console.error("Invalid Firebase Config in LS");
      }
    } else {
      setFirebaseConfigStr(JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2));
    }

    if (initializeFirebase(configToUse)) {
      console.log("Firebase initialized");
      const unsubscribe = onUserChange((u) => {
        if (u) {
          setUser({
            uid: u.uid,
            displayName: u.displayName,
            email: u.email,
            photoURL: u.photoURL
          });
        } else {
          setUser(null);
        }
      });
      return () => unsubscribe && unsubscribe();
    }
  }, []);

  // Sync Logic: Subscribe to remote changes
  useEffect(() => {
    if (!user) return;
    
    setIsSyncing(true);
    const unsub = subscribeToUserData(user.uid, (data) => {
      if (data) {
        setIsSyncing(true);
        setResult(data);
        setTimeout(() => setIsSyncing(false), 500);
      } else {
        setIsSyncing(false);
      }
    });

    return () => unsub();
  }, [user]);

  // Sync Logic: Save local changes to cloud
  useEffect(() => {
    if (!user || !result || isSyncing) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    setIsSaving(true);
    saveTimeoutRef.current = setTimeout(async () => {
      await saveUserData(user.uid, result);
      setIsSaving(false);
    }, 2000); // Debounce 2 seconds

    return () => clearTimeout(saveTimeoutRef.current);
  }, [result, user, isSyncing]);

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

  const handleSaveConfig = () => {
    try {
      const config = JSON.parse(firebaseConfigStr);
      localStorage.setItem('firebase_config', firebaseConfigStr);
      if (initializeFirebase(config)) {
         alert("Firebase 設定成功！請重新整理頁面以啟用。");
         window.location.reload();
      } else {
         alert("初始化失敗，請檢查 Config 格式。");
      }
    } catch (e) {
      alert("JSON 格式錯誤，請檢查。");
    }
  };

  const handleSaveApiKey = () => {
      if (!apiKeyInput.trim()) return;
      setApiKey(apiKeyInput.trim());
      setIsApiKeyModalOpen(false);
  };

  const handleLogin = async () => {
    setLoginError(null);
    try {
      await loginWithGoogle();
    } catch (e: any) {
      console.error("Login Error:", e);
      if (e.code === 'auth/unauthorized-domain' || (e.message && e.message.includes('unauthorized-domain'))) {
        setIsSettingsOpen(true);
        setShowTutorial(true);
        setLoginError('auth/unauthorized-domain');
      } else {
        alert("登入失敗: " + (e.message || "未知錯誤"));
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setResult(null);
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

  // Helper: Parse "City District" string
  const parseLocation = (loc: string) => {
    if (!loc) return { city: '未分類地區', district: '其他' };
    
    // 1. Remove common Country prefixes using Regex
    let cleaned = loc.replace(/^(台灣|臺灣|日本|南韓|韓國|泰國|越南)\s*/, '').trim();
    if (!cleaned) return { city: '未分類地區', district: '其他' };

    // 2. Try splitting by space first
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
        return { city: parts[0], district: parts.slice(1).join(' ') };
    }

    // 3. Fallback: Regex for splitting "CityDistrict" (e.g. 台北市信義區)
    const cityMatch = cleaned.match(/^(.{2,}[市縣都府])(.+)$/);
    if (cityMatch) {
        return { city: cityMatch[1], district: cityMatch[2] };
    }

    // 4. Fallback: Just City
    return { city: cleaned, district: '市區' };
  };

  // Derived state for unique Cities (Major Categories)
  const uniqueCities = useMemo(() => {
    if (!result) return [];
    const cities = new Set<string>();
    result.places.forEach(p => {
      const { city } = parseLocation(p.locationGuess || '');
      cities.add(city);
    });
    return Array.from(cities).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }, [result]);

  // Derived state for Districts within the Active City
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

  const handleAnalyze = async () => {
    if (!rawInput.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await analyzeMapData(rawInput);
      setResult(data);
    } catch (err: any) {
      if (err.message === "API_KEY_MISSING") {
          setIsApiKeyModalOpen(true);
          return;
      }
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
        if (err.message === "API_KEY_MISSING") {
            setIsApiKeyModalOpen(true);
            return;
        }
        setError(err.message || "圖片分析失敗。");
    } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAdding(true);
    setError(null);

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

        const newData = await analyzeImage(base64, file.type);
        setResult(prev => {
            if (!prev) return newData;
            return {
                ...prev,
                places: [...prev.places, ...newData.places],
                summary: prev.summary,
                suggestedItinerary: prev.suggestedItinerary
            };
        });
        closeAddModal();
    } catch (err: any) {
        if (err.message === "API_KEY_MISSING") {
            setIsApiKeyModalOpen(true);
            return;
        }
        alert(err.message || "圖片分析失敗。");
    } finally {
        setIsAdding(false);
        if (addFileInputRef.current) addFileInputRef.current.value = '';
    }
  };

  const handleAppendAnalyze = async () => {
    if (!addInput.trim()) return;
    setIsAdding(true);
    setError(null); 
    try {
      const categoryHint = addCategory === 'AUTO' ? undefined : addCategory;
      const newData = await analyzeMapData(addInput, categoryHint);
      setResult(prev => {
        if (!prev) return newData;
        return {
          ...prev,
          places: [...prev.places, ...newData.places],
          summary: prev.summary || newData.summary,
          suggestedItinerary: newData.suggestedItinerary 
            ? (prev.suggestedItinerary ? prev.suggestedItinerary + "\n\n" + newData.suggestedItinerary : newData.suggestedItinerary)
            : prev.suggestedItinerary
        };
      });
      closeAddModal();
    } catch (err: any) {
      if (err.message === "API_KEY_MISSING") {
          setIsApiKeyModalOpen(true);
          return;
      }
      alert(err.message || "新增地點失敗，請稍後再試。");
    } finally {
      setIsAdding(false);
    }
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setAddInput('');
    setAddCategory('AUTO');
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

  const categoryLabels: Record<CategoryType, string> = {
    [CategoryType.FOOD]: "美食",
    [CategoryType.DRINK]: "飲品",
    [CategoryType.SIGHTSEEING]: "景點",
    [CategoryType.SHOPPING]: "購物",
    [CategoryType.ACTIVITY]: "活動",
    [CategoryType.LODGING]: "住宿",
    [CategoryType.OTHER]: "其他"
  };

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 text-gray-800 font-sans">
      
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-systemBlue to-cyan-500 text-white p-1.5 rounded-lg shadow-sm">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984A1 1 0 0021 6a1 1 0 01-1-1 1 1 0 01-1 1 1 1 0 01-1 1H21" />
             </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800 tracking-tight flex items-center gap-2">
            MapSieve AI 
            {isSaving && <span className="text-xs text-gray-400 font-normal animate-pulse ml-2">儲存中...</span>}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button 
              onClick={() => setIsSettingsOpen(true)}
              className={`p-2 rounded-full transition-colors ${user ? 'text-systemBlue bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              title="雲端同步與設定"
          >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
          </button>

          {result && (
            <>
              <div className="relative">
                <button 
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="p-2 text-gray-500 hover:text-systemBlue hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden sm:inline text-sm font-medium">匯出</span>
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                      <button onClick={handleExportKML} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600">
                        匯出 KML (Google Maps)
                      </button>
                      <button onClick={handleExportCSV} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-green-50 hover:text-green-600">
                        匯出 CSV (Excel)
                      </button>
                  </div>
                )}
                {isExportMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>}
              </div>

              <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>

              <button 
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 bg-systemBlue hover:bg-blue-600 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">新增地點</span>
                <span className="sm:hidden">新增</span>
              </button>
              
              <button 
                onClick={handleReset}
                className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                重置
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex-shrink-0 hidden md:flex flex-col z-10">
           <div className="p-4 flex flex-col h-full">
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <input
                    type="text"
                    className="w-full bg-gray-100 border-none rounded-lg py-2 pl-9 pr-3 text-sm text-gray-700 focus:ring-2 focus:ring-systemBlue/50"
                    placeholder="搜尋地點、標籤..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* View Toggle */}
              <div className="bg-gray-100 p-1 rounded-lg flex mb-4">
                <button 
                  onClick={() => setViewMode('CATEGORY')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  依分類
                </button>
                <button 
                  onClick={() => setViewMode('LOCATION')}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'LOCATION' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  依地區
                </button>
              </div>

              {isFilterActive && (
                  <button 
                    onClick={handleResetFilters}
                    className="w-full mb-4 py-2 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    重設所有篩選
                  </button>
              )}

              {/* Navigation List */}
              <div className="flex-grow overflow-y-auto custom-scrollbar pr-1">
                {result ? (
                    <nav className="space-y-1">
                        {viewMode === 'CATEGORY' && (
                            <>
                                <button
                                onClick={() => setActiveCategory('ALL')}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeCategory === 'ALL' ? 'bg-blue-50 text-systemBlue font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                                >
                                全部類別
                                </button>
                                {Object.values(CategoryType).map(cat => {
                                const isActive = activeCategory === cat;
                                return (
                                    <button
                                    key={cat}
                                    onClick={() => setActiveCategory(cat)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${isActive ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                                    >
                                    <span>{categoryLabels[cat]}</span>
                                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-systemBlue"></div>}
                                    </button>
                                );
                                })}
                            </>
                        )}

                        {viewMode === 'LOCATION' && (
                            <>
                                <button
                                    onClick={() => { setActiveLocation('ALL'); setActiveDistrict('ALL'); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeLocation === 'ALL' ? 'bg-blue-50 text-systemBlue font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                                >
                                    全部縣市
                                </button>
                                {uniqueCities.map(city => {
                                    const isActive = activeLocation === city;
                                    return (
                                        <button
                                            key={city}
                                            onClick={() => { setActiveLocation(city); setActiveDistrict('ALL'); }}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group ${isActive ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                                        >
                                            <span className="truncate">{city}</span>
                                            {isActive && <div className="w-1.5 h-1.5 rounded-full bg-systemBlue shrink-0"></div>}
                                        </button>
                                    );
                                })}
                            </>
                        )}
                    </nav>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-xs text-center">
                        <p>尚無資料</p>
                    </div>
                )}
              </div>

              {/* Sidebar Footer */}
              <div className="mt-auto pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                     <span>{result ? placesToShow.length : 0} 個地點</span>
                     <select 
                       value={sortBy}
                       onChange={(e) => setSortBy(e.target.value as any)}
                       className="bg-transparent border-none text-xs p-0 text-systemBlue font-medium focus:ring-0 cursor-pointer"
                       disabled={!result}
                     >
                       <option value="DEFAULT">預設排序</option>
                       <option value="PRICE_ASC">價格低到高</option>
                       <option value="RATING_DESC">評分高到低</option>
                       <option value="LOCATION_ASC">地點名稱</option>
                       <option value="SUBCATEGORY_ASC">類別名稱</option>
                     </select>
                   </div>
              </div>
           </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
            
            {/* List Column */}
            <div ref={mainContentRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-8 custom-scrollbar scroll-smooth">
                {/* Input Dashboard (Empty State) */}
                {!result && (
                    <div className="w-full max-w-2xl mx-auto mt-10">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="bg-blue-100 p-2 rounded-xl">
                                    <svg className="w-6 h-6 text-systemBlue" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                </div>
                                <h2 className="text-2xl font-bold text-gray-800">建立新行程</h2>
                            </div>
                            
                            <p className="text-gray-600 mb-4">
                                輸入 Google Maps 連結、部落格文章網址，或貼上純文字內容。AI 將自動為您解析並整理成結構化行程。
                            </p>

                            <div className="relative">
                            <textarea
                                className="w-full h-40 p-4 text-base text-gray-800 placeholder-gray-400 bg-gray-50 border border-gray-200 focus:border-systemBlue focus:ring-2 focus:ring-blue-100 rounded-xl resize-none transition-all"
                                placeholder="在此貼上..."
                                value={rawInput}
                                onChange={(e) => setRawInput(e.target.value)}
                            />
                            </div>
                            
                            <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex-1 sm:flex-none text-sm font-medium text-gray-600 hover:text-systemBlue bg-white border border-gray-200 hover:border-blue-200 px-4 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        上傳圖片
                                    </button>
                                    <input 
                                        type="file" 
                                        ref={fileInputRef} 
                                        className="hidden" 
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                    />
                                </div>
                                <button
                                    onClick={handleAnalyze}
                                    disabled={isLoading || !rawInput.trim()}
                                    className={`
                                        w-full sm:w-auto px-8 py-2.5 rounded-lg text-sm font-bold text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2
                                        ${isLoading || !rawInput.trim() 
                                        ? 'bg-gray-300 cursor-not-allowed' 
                                        : 'bg-systemBlue hover:bg-blue-600'
                                        }
                                    `}
                                >
                                    {isLoading ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                            分析中...
                                        </>
                                    ) : (
                                        <>開始分析</>
                                    )}
                                </button>
                            </div>

                            {error && (
                                <div className="mt-6 px-4 py-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-sm flex items-start gap-3">
                                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10 text-center">
                            <div className="p-4">
                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-2xl">🔗</div>
                                <h3 className="font-bold text-gray-800">多元來源</h3>
                                <p className="text-sm text-gray-500 mt-1">支援 Google Maps 清單、各大旅遊部落格文章。</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-2xl">📸</div>
                                <h3 className="font-bold text-gray-800">視覺辨識</h3>
                                <p className="text-sm text-gray-500 mt-1">拍下菜單、行程表或書本內容直接分析。</p>
                            </div>
                            <div className="p-4">
                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-2xl">🤖</div>
                                <h3 className="font-bold text-gray-800">AI 顧問</h3>
                                <p className="text-sm text-gray-500 mt-1">分析完成後，可與 AI 對話詢問行程建議。</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Result Content */}
                {result && (
                    <div className="animate-fade-in w-full max-w-7xl mx-auto">
                        
                        {/* Mobile Map View (Replaces Summary Area on Mobile) */}
                        <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 shadow-sm h-64 sm:h-80 md:hidden shrink-0">
                             <MapView 
                                places={placesToShow} 
                                onSelectPlace={setSelectedPlaceId}
                                selectedPlaceId={selectedPlaceId}
                                hoveredPlaceId={hoveredPlaceId}
                            />
                        </div>

                        {/* Mobile Filters (Only visible on small screens) */}
                        <div className="md:hidden mb-6 space-y-3">
                            <input
                                type="text"
                                className="w-full bg-white border border-gray-200 rounded-lg py-2 px-4 text-sm shadow-sm"
                                placeholder="搜尋..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                <button onClick={() => setViewMode('CATEGORY')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>分類</button>
                                <button onClick={() => setViewMode('LOCATION')} className={`flex-1 py-1.5 text-xs font-medium rounded-md ${viewMode === 'LOCATION' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>地區</button>
                            </div>
                        </div>

                        {/* Secondary Navigation for District (Sticky) */}
                        {viewMode === 'LOCATION' && activeLocation !== 'ALL' && availableDistricts.length > 0 && (
                            <div className="sticky top-0 z-20 -mx-4 px-4 pb-4 pt-2 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 mb-6">
                                <div className="flex overflow-x-auto gap-2 py-1 hide-scrollbar">
                                    <button 
                                    onClick={() => setActiveDistrict('ALL')}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${activeDistrict === 'ALL' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                                    >
                                    全部地區
                                    </button>
                                    {availableDistricts.map(dist => (
                                        <button 
                                        key={dist}
                                        onClick={() => setActiveDistrict(dist)}
                                        className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${activeDistrict === dist ? 'bg-systemBlue text-white border-systemBlue' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                                        >
                                        {dist}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Places Grid */}
                        {placesToShow.length > 0 ? (
                            <>
                                {groupedPlaces ? (
                                    <div className="space-y-12">
                                        {groupedPlaces.sortedKeys.map(key => (
                                            <div key={key}>
                                                <div className="flex items-center gap-3 mb-6 pb-2 border-b border-gray-200">
                                                    <h2 className="text-xl font-bold text-gray-800">{key}</h2>
                                                    <span className="bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full text-xs font-bold">{groupedPlaces.groups[key].length}</span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                                                    {groupedPlaces.groups[key].map(place => (
                                                        <PlaceCard 
                                                            key={place.id} 
                                                            id={`card-${place.id}`}
                                                            place={place} 
                                                            onDelete={handleRemovePlace}
                                                            onAddPlace={() => setIsAddModalOpen(true)}
                                                            isSelected={selectedPlaceId === place.id}
                                                            onHover={(id) => setHoveredPlaceId(id)}
                                                            onClick={() => setSelectedPlaceId(place.id)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-6 pb-12">
                                        {placesToShow.map((place) => (
                                            <PlaceCard 
                                                key={place.id} 
                                                id={`card-${place.id}`}
                                                place={place} 
                                                onDelete={handleRemovePlace}
                                                onAddPlace={() => setIsAddModalOpen(true)}
                                                isSelected={selectedPlaceId === place.id}
                                                onHover={(id) => setHoveredPlaceId(id)}
                                                onClick={() => setSelectedPlaceId(place.id)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <p>找不到符合條件的地點</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Desktop Map Column (Sticky) */}
            {result && (
                <div className="hidden md:block w-[40%] h-full border-l border-gray-200 relative bg-gray-100">
                     <div className="sticky top-0 h-full w-full">
                        <MapView 
                            places={placesToShow} 
                            onSelectPlace={setSelectedPlaceId}
                            selectedPlaceId={selectedPlaceId}
                            hoveredPlaceId={hoveredPlaceId}
                        />
                     </div>
                </div>
            )}
        </main>
      </div>

      {/* Footer / Status Bar (Fixed at bottom right for info, or hidden) */}
      <div className="fixed bottom-2 right-2 z-50 pointer-events-none opacity-50 hover:opacity-100 transition-opacity">
         <span className="bg-black/70 text-white text-[10px] px-2 py-1 rounded-md">
            Gemini Powered {user && `• ${user.email}`}
         </span>
      </div>

      {/* Widgets (Chat & BackToTop) */}
      {result && <ChatWidget places={result.places} />}
      
      {showBackToTop && (
        <button
            onClick={scrollToTop}
            className="fixed bottom-24 right-6 z-30 p-3 bg-white border border-gray-200 shadow-lg rounded-full text-gray-600 hover:text-systemBlue hover:bg-gray-50 transition-all duration-300"
            title="回到頂端"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
        </button>
      )}

      {/* Modals */}
      
      {/* API Key Modal */}
      {isApiKeyModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center px-4 backdrop-blur-sm">
           <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden p-8">
               <h3 className="text-xl font-bold text-gray-900 text-center mb-4">需要 Gemini API Key</h3>
               <p className="text-sm text-gray-600 text-center mb-6">請輸入您的 Google Gemini API Key 以繼續使用。</p>
               <input 
                   type="password" 
                   value={apiKeyInput}
                   onChange={(e) => setApiKeyInput(e.target.value)}
                   placeholder="AIzaSy..."
                   className="w-full bg-gray-50 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-systemBlue focus:border-transparent mb-6"
               />
               <button 
                   onClick={handleSaveApiKey}
                   disabled={!apiKeyInput.trim()}
                   className="w-full py-3 bg-systemBlue text-white rounded-lg font-bold hover:bg-blue-600 disabled:opacity-50"
               >
                   儲存並開始
               </button>
           </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-800 mb-6">設定</h3>
            
            <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Gemini API Key</label>
                <div className="flex gap-2">
                    <input 
                        type="password"
                        placeholder="AIzaSy..."
                        className="flex-grow bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <button 
                        onClick={() => { setApiKey(apiKeyInput); alert("更新成功"); setApiKeyInput(""); }}
                        className="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-black"
                    >
                        更新
                    </button>
                </div>
            </div>

            <hr className="border-gray-100 my-6" />

            <h3 className="text-lg font-bold text-gray-800 mb-2">雲端同步 (Firebase)</h3>
            
            {/* ... Error & Tutorial UI (Same logic, cleaner style) ... */}
            {loginError === 'auth/unauthorized-domain' && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-700 text-sm font-bold">⚠️ 網域未授權</p>
                    <code className="block mt-2 bg-white border border-red-100 p-2 rounded text-xs">{window.location.hostname}</code>
                </div>
            )}

            {!isFirebaseInitialized() ? (
                <div className="space-y-4">
                     <button 
                        onClick={() => setShowTutorial(!showTutorial)}
                        className="text-systemBlue text-sm hover:underline"
                     >
                        如何設定 Firebase?
                     </button>
                    {showTutorial && (
                        <div className="bg-gray-50 p-4 rounded-lg text-xs text-gray-600 space-y-2">
                            {/* Tutorial Content */}
                            <p>請前往 Firebase Console 複製 Config JSON。</p>
                        </div>
                    )}
                    <textarea
                        className="w-full h-32 bg-gray-50 border border-gray-300 rounded-lg p-3 text-xs font-mono"
                        value={firebaseConfigStr}
                        onChange={(e) => setFirebaseConfigStr(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={handleSaveConfig} className="px-4 py-2 bg-systemBlue text-white rounded-lg text-sm">儲存</button>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                     <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg text-sm font-medium">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Firebase 已連線
                     </div>
                     {!user ? (
                        <button onClick={handleLogin} className="w-full py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                            登入 Google 帳號
                        </button>
                     ) : (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {user.photoURL && <img src={user.photoURL} className="w-8 h-8 rounded-full" />}
                                <span className="text-sm font-medium">{user.displayName}</span>
                            </div>
                            <button onClick={handleLogout} className="text-red-600 text-sm hover:underline">登出</button>
                        </div>
                     )}
                </div>
            )}
            
            <div className="mt-8 flex justify-end">
                <button onClick={() => setIsSettingsOpen(false)} className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">新增地點</h3>
                <textarea
                    className="w-full h-32 bg-gray-50 border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-systemBlue resize-none mb-4"
                    placeholder="https://..."
                    value={addInput}
                    onChange={(e) => setAddInput(e.target.value)}
                />
                 <div className="flex gap-2 mb-4">
                    <button 
                        onClick={() => addFileInputRef.current?.click()}
                        className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
                    >
                         <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        上傳圖片
                    </button>
                    <input type="file" ref={addFileInputRef} className="hidden" accept="image/*" onChange={handleAddImageUpload} />
                 </div>

                 <select 
                    value={addCategory}
                    onChange={(e) => setAddCategory(e.target.value as any)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-lg py-2 px-3 text-sm mb-6"
                 >
                    <option value="AUTO">自動偵測類別</option>
                    {Object.values(CategoryType).map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}
                 </select>

                 <div className="flex gap-3">
                    <button onClick={closeAddModal} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200">取消</button>
                    <button onClick={handleAppendAnalyze} disabled={isAdding} className="flex-1 py-2.5 bg-systemBlue text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50">
                        {isAdding ? '新增中...' : '確認新增'}
                    </button>
                 </div>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;