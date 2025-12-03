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

  // State for Map View
  const [showMap, setShowMap] = useState<boolean>(false);
  
  // State for Selection Highlight
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

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
        // We received data from cloud. 
        // We need to differentiate between "My local change echoed back" vs "Remote change".
        // For simplicity, we just update state and set a flag to ignore the next save effect.
        setIsSyncing(true);
        setResult(data);
        // Small timeout to allow the state to settle before enabling save again
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
      // onUserChange will handle state update
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
    setResult(null); // Clear data on logout for privacy
    // Persistence effect will handle removing from localStorage
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
    const parts = loc.split(' ');
    // Handle cases where there is no space or only one word
    if (parts.length === 1) return { city: parts[0], district: '市區' };
    const city = parts[0];
    const district = parts.slice(1).join(' ');
    return { city, district };
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
    setResult(null); // Clear previous result for fresh analysis

    try {
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // Remove data:image/png;base64, prefix
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
                summary: prev.summary, // Keep original summary
                suggestedItinerary: prev.suggestedItinerary // Keep original itinerary
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
    setShowMap(false);
    setSelectedPlaceId(null);
    // LocalStorage will be cleared by the useEffect because result becomes null
  };

  // Resets filters and sorting within the results view
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
    
    // 1. Primary Filter (View Mode)
    if (viewMode === 'CATEGORY') {
        if (activeCategory !== 'ALL') {
            filtered = filtered.filter(p => p.category === activeCategory);
        }
    } else {
        // Location Mode Logic
        if (activeLocation !== 'ALL') {
             filtered = filtered.filter(p => {
                const { city } = parseLocation(p.locationGuess || '');
                return city === activeLocation;
             });
             
             // Secondary Filter: District
             if (activeDistrict !== 'ALL') {
                filtered = filtered.filter(p => {
                    const { district } = parseLocation(p.locationGuess || '');
                    return district === activeDistrict;
                });
             }
        }
    }

    // 2. Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.subCategory.toLowerCase().includes(query) ||
        p.tags.some(tag => tag.toLowerCase().includes(query)) ||
        (p.locationGuess || '').toLowerCase().includes(query)
      );
    }

    // 3. Sorting
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

  // Helper to group places dynamically based on current zoom level
  const groupedPlaces = useMemo(() => {
    if (viewMode !== 'LOCATION') return null;
    
    // Level 3: Specific District selected -> No grouping needed, flat grid
    if (activeLocation !== 'ALL' && activeDistrict !== 'ALL') return null;

    const groups: Record<string, Place[]> = {};
    const groupingType = activeLocation === 'ALL' ? 'CITY' : 'DISTRICT';

    placesToShow.forEach(p => {
      const { city, district } = parseLocation(p.locationGuess || '');
      const key = groupingType === 'CITY' ? city : district;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    
    // Sort keys
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
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      {/* Main Window Container - Always Full Size */}
      <div className="mac-window w-full max-w-7xl h-[90vh] rounded-[20px] flex flex-col overflow-hidden shadow-mac-window transition-all duration-500 ease-out">
        
        {/* Title Bar / Toolbar */}
        <div className="h-14 bg-white/40 backdrop-blur-lg border-b border-black/5 flex items-center px-5 justify-between shrink-0 drag-region">
          <div className="flex items-center gap-4">
             {/* Mac Window Controls */}
            <div className="flex gap-2 group">
              <div className="w-3 h-3 rounded-full bg-systemRed border border-red-400/50 shadow-sm"></div>
              <div className="w-3 h-3 rounded-full bg-systemYellow border border-yellow-400/50 shadow-sm"></div>
              <div className="w-3 h-3 rounded-full bg-systemGreen border border-green-400/50 shadow-sm"></div>
            </div>
            <div className="h-4 w-[1px] bg-black/10 mx-1"></div>
            <h1 className="text-sm font-semibold text-gray-700 tracking-wide cursor-default select-none flex items-center gap-2">
              MapSieve AI 
              <span className="text-gray-400 font-normal hidden sm:inline-block">智能助理</span>
              {isSaving && <span className="text-[10px] text-gray-400 animate-pulse">儲存中...</span>}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Sync Button */}
            <button 
                onClick={() => setIsSettingsOpen(true)}
                className={`p-1.5 rounded-md transition-all ${user ? 'text-systemBlue bg-systemBlue/10 hover:bg-systemBlue/20' : 'text-gray-400 hover:text-gray-600 hover:bg-black/5'}`}
                title="雲端同步與設定"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>

            {result && (
              <>
                {/* Export Dropdown */}
                <div className="relative">
                  <button 
                    onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                    className="p-1.5 text-gray-500 hover:text-systemBlue hover:bg-black/5 rounded-md transition-all"
                    title="匯出行程"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  {isExportMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-40 bg-white/95 backdrop-blur-xl border border-gray-200 rounded-lg shadow-xl py-1 z-50 animate-fade-in">
                       <button onClick={handleExportKML} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-systemBlue hover:text-white flex items-center gap-2">
                          <span className="text-xs font-bold bg-blue-100 text-blue-700 px-1 rounded">KML</span> Google Maps
                       </button>
                       <button onClick={handleExportCSV} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-systemGreen hover:text-white flex items-center gap-2">
                          <span className="text-xs font-bold bg-green-100 text-green-700 px-1 rounded">CSV</span> Excel/Notion
                       </button>
                    </div>
                  )}
                  {isExportMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>}
                </div>

                <div className="h-4 w-[1px] bg-black/10 mx-1"></div>

                <button 
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-3 py-1 bg-white/80 hover:bg-white border border-black/10 rounded-md text-xs font-medium text-gray-700 shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  新增
                </button>
                <button 
                  onClick={handleReset}
                  className="px-3 py-1 bg-white/80 hover:bg-white border border-black/10 rounded-md text-xs font-medium text-gray-700 shadow-sm transition-all active:scale-95"
                >
                  重新開始
                </button>
              </>
            )}
          </div>
        </div>

        {/* DASHBOARD LAYOUT */}
        <div className="flex h-full">
            {/* Sidebar / Filter Panel (Always Visible) */}
            <div className="w-64 bg-white/40 backdrop-blur-md border-r border-black/5 flex-shrink-0 hidden md:flex flex-col p-4">
            
            {/* Search Bar */}
            <div className="mb-4">
                <div className="relative">
                <input
                    type="text"
                    className="w-full bg-black/5 border-none rounded-lg py-1.5 pl-8 pr-3 text-sm text-gray-700 focus:ring-2 focus:ring-systemBlue/50 placeholder-gray-400/70 transition-all"
                    placeholder="搜尋..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                </div>
            </div>

            {/* View Mode Toggle (Segmented Control) */}
            <div className="bg-black/5 p-1 rounded-lg flex mb-4">
                <button 
                onClick={() => setViewMode('CATEGORY')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                >
                依分類
                </button>
                <button 
                onClick={() => setViewMode('LOCATION')}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'LOCATION' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                >
                依地區
                </button>
            </div>

            {isFilterActive && (
                <button 
                onClick={handleResetFilters}
                className="w-full mb-4 py-1.5 text-xs font-medium text-systemRed bg-systemRed/5 hover:bg-systemRed/10 border border-systemRed/10 rounded-lg transition-all flex items-center justify-center gap-1.5 animate-fade-in"
                >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                重設篩選與排序
                </button>
            )}

            <div className="flex-grow overflow-y-auto pr-1 custom-scrollbar">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2">
                {viewMode === 'CATEGORY' ? '類別篩選' : '縣市篩選'}
                </h3>
                
                <nav className="space-y-1">
                {/* Render Category List */}
                {result && viewMode === 'CATEGORY' && (
                    <>
                        <button
                        onClick={() => setActiveCategory('ALL')}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${activeCategory === 'ALL' ? 'bg-systemBlue text-white shadow-md font-medium' : 'text-gray-600 hover:bg-black/5'}`}
                        >
                        全部類別
                        </button>
                        {Object.values(CategoryType).map(cat => {
                        const isActive = activeCategory === cat;
                        return (
                            <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between group ${isActive ? 'bg-white text-gray-800 font-medium shadow-sm ring-1 ring-black/5' : 'text-gray-600 hover:bg-black/5'}`}
                            >
                            <span>{categoryLabels[cat]}</span>
                            {isActive && <div className="w-1.5 h-1.5 rounded-full bg-systemBlue"></div>}
                            </button>
                        );
                        })}
                    </>
                )}

                {/* Render City List (Level 1 Location) */}
                {result && viewMode === 'LOCATION' && (
                    <>
                        <button
                            onClick={() => { setActiveLocation('ALL'); setActiveDistrict('ALL'); }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${activeLocation === 'ALL' ? 'bg-systemBlue text-white shadow-md font-medium' : 'text-gray-600 hover:bg-black/5'}`}
                        >
                            全部縣市
                        </button>
                        {uniqueCities.map(city => {
                            const isActive = activeLocation === city;
                            return (
                                <button
                                    key={city}
                                    onClick={() => { setActiveLocation(city); setActiveDistrict('ALL'); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between group ${isActive ? 'bg-white text-gray-800 font-medium shadow-sm ring-1 ring-black/5' : 'text-gray-600 hover:bg-black/5'}`}
                                >
                                    <span className="truncate">{city}</span>
                                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-systemBlue shrink-0"></div>}
                                </button>
                            );
                        })}
                    </>
                )}
                
                {!result && (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">
                        暫無資料
                    </div>
                )}
                </nav>
            </div>

                <div className="mt-auto pt-4 border-t border-black/5 shrink-0">
                <div className="flex items-center justify-between text-xs text-gray-500 px-2">
                    <span>{result ? placesToShow.length : 0} 個地點</span>
                    <select 
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="bg-transparent border-none text-xs p-0 text-systemBlue font-medium focus:ring-0 cursor-pointer"
                    disabled={!result}
                    >
                    <option value="DEFAULT">預設</option>
                    <option value="PRICE_ASC">價格</option>
                    <option value="RATING_DESC">評分</option>
                    <option value="LOCATION_ASC">地區</option>
                    <option value="SUBCATEGORY_ASC">類別</option>
                    </select>
                </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-grow overflow-y-auto overflow-x-hidden bg-white/30 relative p-6">
            {!result ? (
                // EMPTY STATE (DASHBOARD WORKSPACE STYLE)
                <div className="flex flex-col items-center justify-start min-h-full py-8 px-4">
                    <div className="w-full max-w-4xl">
                        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/50 shadow-mac-card p-6">
                            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                <span className="bg-systemBlue/10 p-1.5 rounded text-systemBlue">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                </span>
                                新增行程分析
                            </h2>
                            
                            <div className="relative group">
                                <textarea
                                    className="w-full h-32 p-4 text-sm text-gray-800 placeholder-gray-400 bg-gray-50/50 border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-systemBlue/50 focus:bg-white transition-all"
                                    placeholder="在此貼上 Google Maps 連結、部落格文章內容，或直接輸入文字..."
                                    value={rawInput}
                                    onChange={(e) => setRawInput(e.target.value)}
                                />
                                {isUrlInput(rawInput) && (
                                    <div className="absolute top-2 right-2 px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-medium rounded border border-blue-100 flex items-center gap-1">
                                        <span>🌐</span> URL 偵測
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-4">
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex-1 sm:flex-none text-xs text-gray-600 hover:text-systemBlue hover:bg-systemBlue/5 border border-gray-200 hover:border-systemBlue/30 px-3 py-2 rounded-lg transition-all flex items-center justify-center gap-2 group"
                                    >
                                        <div className="p-1 bg-gray-100 group-hover:bg-blue-100 rounded text-gray-500 group-hover:text-blue-600">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                        上傳圖片分析
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
                                        w-full sm:w-auto px-6 py-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2
                                        ${isLoading || !rawInput.trim() 
                                        ? 'bg-gray-300 cursor-not-allowed' 
                                        : 'bg-systemBlue hover:bg-blue-600'
                                        }
                                    `}
                                >
                                    {isLoading && <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                    {isLoading ? '正在分析...' : '開始分析'}
                                </button>
                            </div>

                            {error && (
                                <div className="mt-4 px-4 py-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-xs flex items-center gap-2 animate-fade-in">
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {error}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                            <div className="bg-white/40 p-4 rounded-xl border border-white/50 text-center">
                                <div className="text-2xl mb-2">🗺️</div>
                                <h3 className="text-sm font-semibold text-gray-700">自動分類</h3>
                                <p className="text-xs text-gray-500 mt-1">智慧識別美食、景點、住宿</p>
                            </div>
                             <div className="bg-white/40 p-4 rounded-xl border border-white/50 text-center">
                                <div className="text-2xl mb-2">📍</div>
                                <h3 className="text-sm font-semibold text-gray-700">地圖定位</h3>
                                <p className="text-xs text-gray-500 mt-1">自動修正座標與連結</p>
                            </div>
                             <div className="bg-white/40 p-4 rounded-xl border border-white/50 text-center">
                                <div className="text-2xl mb-2">☁️</div>
                                <h3 className="text-sm font-semibold text-gray-700">雲端同步</h3>
                                <p className="text-xs text-gray-500 mt-1">跨裝置無縫接軌</p>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                // RESULTS VIEW
                <>
                {/* Secondary Navigation for District (Level 2) - Sticky Header */}
                {viewMode === 'LOCATION' && activeLocation !== 'ALL' && availableDistricts.length > 0 && (
                    <div className="sticky top-0 z-20 -mx-6 px-6 pb-4 bg-white/0 backdrop-blur-none">
                        <div className="flex overflow-x-auto gap-2 py-2 hide-scrollbar mask-gradient-right">
                            <button 
                                onClick={() => setActiveDistrict('ALL')}
                                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${activeDistrict === 'ALL' ? 'bg-gray-800 text-white border-gray-800 shadow-md' : 'bg-white/80 backdrop-blur-md text-gray-600 border-gray-200 hover:bg-white'}`}
                            >
                                全部鄉鎮
                            </button>
                            {availableDistricts.map(dist => (
                                <button 
                                    key={dist}
                                    onClick={() => setActiveDistrict(dist)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${activeDistrict === dist ? 'bg-systemBlue text-white border-systemBlue shadow-md' : 'bg-white/80 backdrop-blur-md text-gray-600 border-gray-200 hover:bg-white'}`}
                                >
                                    {dist}
                                </button>
                            ))}
                        </div>
                    </div>
                )}


                {/* Summary Widget */}
                {viewMode === 'CATEGORY' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="col-span-1 lg:col-span-2 bg-white/60 backdrop-blur-sm p-5 rounded-2xl border border-white/50 shadow-mac-card">
                    <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center">
                    <span className="bg-systemGray/10 p-1 rounded mr-2 text-systemGray">📝</span>
                    行程總結
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                    {result.summary}
                    </p>
                </div>

                {/* Itinerary Widget */}
                {result.suggestedItinerary && (
                    <div className="bg-gradient-to-br from-systemIndigo/5 to-systemBlue/5 p-5 rounded-2xl border border-systemBlue/10 shadow-mac-card overflow-y-auto max-h-48">
                    <h3 className="text-sm font-bold text-systemIndigo mb-2 flex items-center">
                        <span className="bg-systemIndigo/10 p-1 rounded mr-2">🗺️</span>
                        建議路線
                    </h3>
                    <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">
                        {result.suggestedItinerary}
                    </p>
                    </div>
                )}
                </div>
                )}

                {/* Mobile Search & Filter (visible only on small screens) */}
                <div className="md:hidden mb-6 space-y-3">
                    <input
                        type="text"
                        className="w-full bg-white/60 border-none rounded-xl py-2 px-4 text-sm shadow-sm"
                        placeholder="搜尋..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    
                    {/* Mobile View Toggle */}
                    <div className="bg-white/40 p-1 rounded-lg flex">
                        <button onClick={() => setViewMode('CATEGORY')} className={`flex-1 py-1 text-xs font-medium rounded-md ${viewMode === 'CATEGORY' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>分類</button>
                        <button onClick={() => setViewMode('LOCATION')} className={`flex-1 py-1 text-xs font-medium rounded-md ${viewMode === 'LOCATION' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>地區</button>
                    </div>

                    {isFilterActive && (
                        <button 
                            onClick={handleResetFilters}
                            className="w-full py-2 text-xs font-medium text-systemRed bg-white/60 border border-systemRed/20 rounded-xl shadow-sm flex items-center justify-center gap-1.5"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                            重設篩選
                        </button>
                    )}
                </div>

                {/* Map Toggle */}
                <div className="mb-6 flex justify-end">
                <button
                    onClick={() => setShowMap(!showMap)}
                    className={`
                    px-4 py-1.5 rounded-lg text-xs font-medium border transition-all shadow-sm
                    ${showMap 
                        ? 'bg-systemBlue text-white border-systemBlue' 
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }
                    `}
                >
                    {showMap ? '隱藏地圖' : '顯示地圖'}
                </button>
                </div>

                {showMap && (
                <div className="mb-8 animate-fade-in">
                    <MapView places={placesToShow} onSelectPlace={setSelectedPlaceId} />
                </div>
                )}

                {/* Grid */}
                {placesToShow.length > 0 ? (
                <>
                    {/* IF groupedPlaces is available (for Location view hierarchy), use it */}
                    {groupedPlaces ? (
                        <div className="space-y-10">
                            {groupedPlaces.sortedKeys.map(key => (
                                <div key={key} className="animate-fade-in">
                                    <div className="flex items-center gap-3 mb-4 sticky top-12 bg-white/30 backdrop-blur-md p-2 rounded-lg z-10 -ml-2">
                                        <div className={`p-1.5 rounded-md ${groupedPlaces.groupingType === 'CITY' ? 'bg-systemBlue/10 text-systemBlue' : 'bg-systemGreen/10 text-systemGreen'}`}>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                        </div>
                                        <h2 className="text-lg font-bold text-gray-800">{key}</h2>
                                        <span className="text-xs text-gray-400 font-medium px-2 py-0.5 bg-white/50 rounded-full border border-black/5">{groupedPlaces.groups[key].length}</span>
                                        <div className="h-px bg-gray-300/30 flex-grow"></div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                                        {groupedPlaces.groups[key].map(place => (
                                            <PlaceCard 
                                                key={place.id} 
                                                id={`card-${place.id}`}
                                                place={place} 
                                                onDelete={handleRemovePlace}
                                                onAddPlace={() => setIsAddModalOpen(true)}
                                                isSelected={selectedPlaceId === place.id}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        // Standard Grid for Category View or Specific Location (Lowest Level)
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 pb-10">
                            {placesToShow.map((place) => (
                                <PlaceCard 
                                    key={place.id} 
                                    id={`card-${place.id}`}
                                    place={place} 
                                    onDelete={handleRemovePlace}
                                    onAddPlace={() => setIsAddModalOpen(true)}
                                    isSelected={selectedPlaceId === place.id}
                                />
                            ))}
                        </div>
                    )}
                </>
                ) : (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p>找不到符合的地點</p>
                </div>
                )}
                </>
            )}
            </div>
        </div>

        {/* Footer Status Bar */}
        <div className="h-8 bg-white/60 backdrop-blur-md border-t border-black/5 flex items-center px-4 justify-between text-[10px] text-gray-400 shrink-0">
          <div className="flex items-center gap-2">
            <span>Gemini 2.5 Flash & 3.0 Pro</span>
            {user && <span className="text-systemGreen">• 已同步 ({user.email})</span>}
          </div>
          <span>© 2025 MapSieve</span>
        </div>
      </div>

      {/* AI Chat Widget */}
      {result && <ChatWidget places={result.places} />}

      {/* API Key Modal (Shown on mount if missing) */}
      {isApiKeyModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center animate-fade-in px-4">
           <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
               <div className="p-6">
                   <div className="flex flex-col items-center text-center mb-6">
                       <div className="w-12 h-12 bg-systemBlue/10 text-systemBlue rounded-xl flex items-center justify-center mb-4">
                           <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                       </div>
                       <h3 className="text-xl font-bold text-gray-800">需要 Gemini API Key</h3>
                       <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                           由於 Vercel 環境限制，請手動輸入您的 Google Gemini API Key 以啟動服務。
                           <br/>
                           <span className="text-xs text-gray-400">(此 Key 僅儲存於您的瀏覽器 LocalStorage)</span>
                       </p>
                   </div>
                   
                   <div className="space-y-4">
                       <div>
                           <label className="text-xs font-medium text-gray-600 ml-1 mb-1 block">API Key</label>
                           <input 
                               type="password" 
                               value={apiKeyInput}
                               onChange={(e) => setApiKeyInput(e.target.value)}
                               placeholder="AIzaSy..."
                               className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-systemBlue/50"
                           />
                       </div>
                       <div className="text-xs text-center">
                           <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-systemBlue hover:underline">
                               前往 Google AI Studio 取得 API Key
                           </a>
                       </div>
                   </div>
               </div>
               <div className="bg-gray-50 px-6 py-4 flex justify-end">
                   <button 
                       onClick={handleSaveApiKey}
                       disabled={!apiKeyInput.trim()}
                       className="px-6 py-2 bg-systemBlue text-white rounded-lg text-sm font-medium shadow-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                       儲存並繼續
                   </button>
               </div>
           </div>
        </div>
      )}

      {/* Settings / Sync Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in p-4">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-xl rounded-xl shadow-2xl border border-white/50 p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">設定與雲端同步</h3>
            
            {/* API Key Section */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                    Gemini API Key
                </h4>
                <div className="flex gap-2">
                    <input 
                        type="password"
                        placeholder="更新您的 API Key..."
                        className="flex-grow bg-white border border-gray-300 rounded px-3 py-1.5 text-sm"
                        onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <button 
                        onClick={() => { setApiKey(apiKeyInput); alert("API Key 已更新"); setApiKeyInput(""); }}
                        className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded hover:bg-black"
                    >
                        更新
                    </button>
                </div>
            </div>

            <h3 className="text-sm font-semibold text-gray-800 mb-2 mt-6 border-t pt-4">Firebase 雲端同步</h3>
            <p className="text-xs text-gray-500 mb-4">
              此應用程式使用 Google Firebase 進行資料同步。請在下方貼上您的 Firebase Config JSON。
            </p>

            {/* Error Banner for Unauthorized Domain */}
            {loginError === 'auth/unauthorized-domain' && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 animate-pulse">
                    <h4 className="text-red-700 font-bold text-sm mb-1">⚠️ 網域未授權 (Domain Not Authorized)</h4>
                    <p className="text-red-600 text-xs mb-2">Google 安全機制阻擋了此請求。請將以下網域加入 Firebase Console 的白名單。</p>
                    <div className="flex items-center gap-2">
                        <code className="bg-white border border-red-200 px-2 py-1 rounded text-red-800 font-mono text-xs select-all">
                            {window.location.hostname}
                        </code>
                        <button 
                            onClick={() => navigator.clipboard.writeText(window.location.hostname)}
                            className="text-xs text-red-700 underline hover:text-red-800"
                        >
                            複製
                        </button>
                    </div>
                    <p className="text-red-500 text-[10px] mt-2">請參考下方教學步驟 3。</p>
                </div>
            )}

            {!isFirebaseInitialized() ? (
                <div className="space-y-4">
                     <button 
                        onClick={() => setShowTutorial(!showTutorial)}
                        className="w-full text-left px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-systemBlue text-xs font-medium flex justify-between items-center transition-colors"
                     >
                        <span>🤔 如何取得設定檔？(新手教學)</span>
                        <svg className={`w-4 h-4 transform transition-transform ${showTutorial ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                     </button>
                    
                    {showTutorial && (
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-xs text-gray-600 space-y-3 leading-relaxed animate-fade-in">
                            <p className="font-bold text-gray-800">只需 3 分鐘，請跟隨以下步驟：</p>
                            <ol className="list-decimal list-inside space-y-1 ml-1">
                                <li>前往 <a href="https://console.firebase.google.com/" target="_blank" className="text-systemBlue underline">Firebase Console</a> 並建立新專案。</li>
                                <li>
                                    在左側選單點擊 <strong>Build &gt; Authentication</strong>：
                                    <ul className="list-disc list-inside ml-4 text-gray-500 mt-1">
                                        <li>點擊 Get Started，選擇 <strong>Google</strong> 並啟用。</li>
                                    </ul>
                                </li>
                                <li>
                                    <strong>重要：設定授權網域 (Authorized Domains)</strong>
                                    <ul className="list-disc list-inside ml-4 text-gray-500 mt-1">
                                        <li>在 <strong>Authentication &gt; Settings</strong> 分頁。</li>
                                        <li>找到 <strong>Authorized domains</strong> 區塊。</li>
                                        <li>
                                            點擊 Add domain，加入您目前的網域：<br/>
                                            <code className="bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded select-all cursor-pointer" onClick={() => navigator.clipboard.writeText(window.location.hostname)} title="點擊複製">{window.location.hostname}</code>
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    在左側選單點擊 <strong>Build &gt; Firestore Database</strong>：
                                    <ul className="list-disc list-inside ml-4 text-gray-500 mt-1">
                                        <li>點擊 Create Database，選擇 <strong>Start in production mode</strong>。</li>
                                    </ul>
                                </li>
                                <li>點擊左上角的「齒輪圖示」&gt; <strong>Project settings</strong>。</li>
                                <li>在 Your apps 區塊點擊 <strong>Web (&lt;/&gt;)</strong> 圖示註冊應用程式。</li>
                                <li>複製 <code>const firebaseConfig = &#123; ... &#125;;</code> 大括號內的 JSON 物件。</li>
                            </ol>
                            <div className="mt-2 bg-gray-800 text-gray-200 p-3 rounded font-mono text-[10px] overflow-x-auto">
                                <p className="text-gray-400 mb-1">// 範例格式 (請複製您的專案內容)：</p>
                                &#123;<br/>
                                &nbsp;&nbsp;"apiKey": "AIzaSy...",<br/>
                                &nbsp;&nbsp;"authDomain": "your-project.firebaseapp.com",<br/>
                                &nbsp;&nbsp;"projectId": "your-project",<br/>
                                &nbsp;&nbsp;"storageBucket": "...",<br/>
                                &nbsp;&nbsp;"messagingSenderId": "...",<br/>
                                &nbsp;&nbsp;"appId": "..."<br/>
                                &#125;
                            </div>
                        </div>
                    )}

                    <textarea
                        className="w-full h-32 bg-gray-100 border border-gray-200 rounded-lg p-3 text-xs font-mono focus:ring-2 focus:ring-systemBlue/50"
                        placeholder='{ "apiKey": "AIzaSy...", "authDomain": "...", ... }'
                        value={firebaseConfigStr}
                        onChange={(e) => setFirebaseConfigStr(e.target.value)}
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">關閉</button>
                        <button onClick={handleSaveConfig} className="px-4 py-2 text-sm bg-systemBlue text-white rounded-lg hover:bg-blue-600">儲存並啟用</button>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="bg-systemGreen/10 border border-systemGreen/20 text-systemGreen px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Firebase 已初始化
                    </div>
                    
                    {!user ? (
                        <div className="text-center py-4">
                            <p className="text-sm text-gray-600 mb-4">登入 Google 帳號以開始跨裝置同步。</p>
                            <button onClick={handleLogin} className="px-6 py-2 bg-white border border-gray-300 shadow-sm rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 mx-auto">
                                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                Sign in with Google
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-3">
                                {user.photoURL ? (
                                    <img src={user.photoURL} alt="Avatar" className="w-10 h-10 rounded-full" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-systemBlue/20 text-systemBlue flex items-center justify-center font-bold text-lg">{user.displayName?.[0] || 'U'}</div>
                                )}
                                <div>
                                    <div className="text-sm font-semibold text-gray-800">{user.displayName}</div>
                                    <div className="text-xs text-gray-500">{user.email}</div>
                                </div>
                            </div>
                            <button onClick={handleLogout} className="text-xs text-systemRed hover:underline font-medium">登出</button>
                        </div>
                    )}

                    <div className="flex justify-end pt-4 border-t border-gray-100">
                         <button onClick={() => setIsSettingsOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">完成</button>
                    </div>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Add Modal - macOS Sheet Style */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-start pt-20 justify-center animate-fade-in">
          <div className="bg-white/90 backdrop-blur-xl w-full max-w-md rounded-xl shadow-2xl border border-white/50 p-6 transform transition-all scale-100 flex flex-col gap-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-800">新增地點</h3>
              <p className="text-xs text-gray-500 mt-1">貼上連結或 HTML 程式碼</p>
            </div>
            
            <textarea
              className="w-full h-24 bg-gray-100/50 border border-gray-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-systemBlue/50 focus:border-transparent resize-none"
              placeholder="https://..."
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
            />

            <div className="flex items-center justify-center gap-2 relative">
                <div className="h-px bg-gray-200 w-full absolute top-1/2"></div>
                <span className="bg-white/80 px-2 text-xs text-gray-400 relative z-10 font-medium">或</span>
            </div>

            <div className="flex justify-center">
                <button 
                    onClick={() => addFileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:text-systemBlue hover:border-systemBlue/30 hover:shadow-sm transition-all"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    上傳圖片分析
                </button>
                <input 
                    type="file" 
                    ref={addFileInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={handleAddImageUpload}
                />
            </div>

            <div>
               <label className="text-xs font-medium text-gray-500 ml-1 mb-1 block">指定類別</label>
               <select 
                 value={addCategory}
                 onChange={(e) => setAddCategory(e.target.value as any)}
                 className="w-full bg-gray-100/50 border border-gray-200 rounded-lg py-1.5 px-2 text-sm"
               >
                 <option value="AUTO">自動偵測</option>
                 {Object.values(CategoryType).map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}
               </select>
            </div>

            <div className="flex gap-3 mt-2">
              <button 
                onClick={closeAddModal}
                className="flex-1 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleAppendAnalyze}
                disabled={isAdding || !addInput.trim()}
                className="flex-1 py-2 bg-systemBlue text-white rounded-lg text-sm font-medium shadow-sm hover:bg-blue-600 active:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isAdding ? '處理中...' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;