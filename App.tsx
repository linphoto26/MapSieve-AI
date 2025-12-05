
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { analyzeMapData, analyzeImage } from './services/geminiService';
import { AnalysisResult, CategoryType, Place, UserProfile } from './types';
import PlaceCard from './components/PlaceCard';
import SkeletonCard from './components/SkeletonCard';
import MapView from './components/MapView';
import ChatWidget from './components/ChatWidget';
import { initializeFirebase, loginWithGoogle, logout, onUserChange, saveUserData, subscribeToUserData, isFirebaseInitialized, DEFAULT_FIREBASE_CONFIG, createSharedItinerary, getSharedItinerary } from './services/firebaseService';
import { generateCSV, generateKML, downloadFile } from './services/exportService';

const LOADING_MESSAGES = [
  "正在讀取您的清單...",
  "AI 正在識別地點資訊...",
  "正在搜尋 Google Maps 評論與評分...",
  "正在規劃最佳行程路線...",
  "正在整理分類標籤...",
  "快完成了，請稍候..."
];

const App: React.FC = () => {
  // --- API KEY CHECK START ---
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isCheckingKey, setIsCheckingKey] = useState(true);

  useEffect(() => {
    const checkKey = async () => {
      try {
        if (window.aistudio?.hasSelectedApiKey) {
          const has = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(has);
        } else {
          // Fallback for environments where process.env.API_KEY is statically defined
          setHasApiKey(!!process.env.API_KEY);
        }
      } catch (e) {
        console.error("API Key check failed:", e);
        setHasApiKey(false);
      } finally {
        setIsCheckingKey(false);
      }
    };
    checkKey();
  }, []);

  const handleRequestKey = async () => {
    if (window.aistudio?.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        // Assume success to mitigate race condition where hasSelectedApiKey might lag
        setHasApiKey(true);
      } catch (e) {
        alert("選擇 API Key 發生錯誤，請重試。");
      }
    } else {
        alert("此環境不支援動態 Key 選擇，請檢查環境變數設定。");
    }
  };
  // --- API KEY CHECK END ---

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

  // Export & Share State
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  // Back To Top State
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Mobile Bottom Sheet State
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);

  // Ref for file input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);
  
  // Debounce save timer
  const saveTimeoutRef = useRef<any>(null);

  // Message rotation effect
  useEffect(() => {
    let interval: any;
    if (isLoading || isAdding) {
      let i = 0;
      setLoadingMessage(LOADING_MESSAGES[0]);
      interval = setInterval(() => {
        i = (i + 1) % LOADING_MESSAGES.length;
        setLoadingMessage(LOADING_MESSAGES[i]);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isLoading, isAdding]);

  const isUrlInput = (input: string) => input.trim().match(/^https?:\/\//i);

  // Check URL for shared ID on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('shareId');
    if (shareId) {
        setIsLoading(true);
        getSharedItinerary(shareId).then(sharedData => {
            if (sharedData) {
                setResult(sharedData);
                window.history.replaceState({}, '', window.location.pathname);
                alert("已成功載入分享的行程！");
            } else {
                alert("找不到該分享行程或連結已失效。");
            }
        }).finally(() => {
            setIsLoading(false);
        });
    }
  }, []);

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

  const handleShare = async () => {
    if (!result) return;
    setIsSharing(true);
    try {
        const id = await createSharedItinerary(result);
        const url = `${window.location.origin}${window.location.pathname}?shareId=${id}`;
        setShareLink(url);
        setIsShareModalOpen(true);
    } catch (e: any) {
        alert(e.message || "分享失敗，請稍後再試。");
    } finally {
        setIsSharing(false);
        setIsExportMenuOpen(false);
    }
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

  if (isCheckingKey) {
      return (
          <div className="flex h-screen items-center justify-center bg-gray-50 flex-col gap-4">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-500 text-sm">正在初始化...</p>
          </div>
      );
  }

  if (!hasApiKey) {
      return (
          <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
              <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 text-systemBlue">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-3">歡迎使用 MapSieve AI</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">
                     請選擇或設定您的 Google Gemini API Key 以開始使用智能行程整理功能。
                     <br/>
                     <span className="text-xs text-gray-500 mt-2 block">
                        請確保選用的專案已啟用計費。 <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-systemBlue hover:underline">查看計費說明</a>
                     </span>
                  </p>
                  <button onClick={handleRequestKey} className="w-full bg-systemBlue text-white font-bold py-3 rounded-xl hover:bg-blue-600 transition-colors shadow-lg shadow-blue-200">
                     選擇 API Key
                  </button>
              </div>
          </div>
      );
  }

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
            MapSieve AI 
            {isSaving && <span className="text-xs text-gray-400 font-normal animate-pulse ml-2 hidden sm:inline">儲存中...</span>}
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button onClick={() => setIsSettingsOpen(true)} className={`p-2 rounded-full transition-colors ${user ? 'text-systemBlue bg-blue-50' : 'text-gray-400 hover:text-gray-600'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>

          {(result || isLoading) && (
            <>
              <div className="relative">
                <button disabled={isLoading} onClick={() => setIsExportMenuOpen(!isExportMenuOpen)} className="p-2 text-gray-500 hover:text-systemBlue hover:bg-gray-100 rounded-lg disabled:opacity-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50">
                      <button onClick={handleExportKML} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50">匯出 KML</button>
                      <button onClick={handleExportCSV} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-green-50">匯出 CSV</button>
                      <hr className="my-1 border-gray-100"/>
                      <button onClick={handleShare} disabled={isSharing} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50">{isSharing ? '...' : '分享行程'}</button>
                  </div>
                )}
                {isExportMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>}
              </div>

              <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>

              <button disabled={isLoading} onClick={() => setIsAddModalOpen(true)} className="px-4 py-2 bg-systemBlue hover:bg-blue-600 text-white rounded-lg text-sm font-medium shadow-sm flex items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline">新增地點</span>
              </button>
              
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
                <input type="text" className="w-full bg-gray-100 border-none rounded-lg py-2 px-3 text-sm" placeholder="搜尋..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={isLoading} />
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
                                    <h2 className="text-2xl font-bold text-gray-800">建立新行程</h2>
                                </div>
                                <p className="text-gray-600 mb-4">輸入 Google Maps 連結、部落格文章網址，或貼上純文字內容。</p>
                                <textarea
                                    className="w-full h-40 p-4 text-base text-gray-800 placeholder-gray-400 bg-gray-50 border border-gray-200 focus:border-systemBlue focus:ring-2 focus:ring-blue-100 rounded-xl resize-none"
                                    placeholder="在此貼上..."
                                    value={rawInput}
                                    onChange={(e) => setRawInput(e.target.value)}
                                />
                                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-4">
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 sm:flex-none text-sm font-medium text-gray-600 hover:text-systemBlue bg-white border border-gray-200 px-4 py-2.5 rounded-lg flex items-center justify-center gap-2">
                                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            上傳圖片
                                        </button>
                                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    </div>
                                    <button onClick={handleAnalyze} disabled={isLoading || !rawInput.trim()} className={`w-full sm:w-auto px-8 py-2.5 rounded-lg text-sm font-bold text-white shadow-sm transition-all ${isLoading || !rawInput.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-systemBlue hover:bg-blue-600'}`}>
                                        {isLoading ? '分析中...' : '開始分析'}
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
                                                                onAddPlace={() => setIsAddModalOpen(true)}
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
                                                    onAddPlace={() => setIsAddModalOpen(true)}
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

                            {/* Append Loading State: Show skeletons at bottom */}
                            {isAdding && (
                                <div className="mt-6 pt-6 border-t border-gray-100">
                                    <div className="flex items-center gap-2 mb-4 text-blue-600 animate-pulse">
                                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                                        <span className="text-sm font-bold">{loadingMessage}</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                        {Array.from({ length: 2 }).map((_, i) => (
                                            <SkeletonCard key={`skeleton-append-${i}`} />
                                        ))}
                                    </div>
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

      {/* Modals ... (Settings, Share, Add) */}
      {isShareModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center">
                <h3 className="text-lg font-bold text-gray-900 mb-2">連結已建立！</h3>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-200 p-2 mb-4">
                    <input readOnly value={shareLink} className="bg-transparent w-full text-xs text-gray-600 outline-none"/>
                    <button onClick={() => navigator.clipboard.writeText(shareLink).then(() => alert("已複製！"))} className="text-systemBlue font-bold text-xs">複製</button>
                </div>
                <button onClick={() => setIsShareModalOpen(false)} className="w-full py-2 bg-gray-100 rounded-lg text-sm font-medium">關閉</button>
            </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6">
            <h3 className="text-xl font-bold mb-6">設定</h3>
            
            {/* Tutorial Section */}
            <div className="mb-6 border-t pt-4">
               <div className="flex justify-between items-center mb-2">
                 <h4 className="font-bold text-gray-700">如何取得 Firebase 設定檔？(新手教學)</h4>
                 <button onClick={() => setShowTutorial(!showTutorial)} className="text-blue-500 text-sm">{showTutorial ? '隱藏' : '顯示'}</button>
               </div>
               
               {loginError === 'auth/unauthorized-domain' && (
                 <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
                    <p className="font-bold flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      網域未授權 (Unauthorized Domain)
                    </p>
                    <p className="mt-1">請將以下網址加入 Firebase Console 的 Authorized Domains：</p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="bg-red-100 px-2 py-1 rounded select-all">{window.location.hostname}</code>
                        <button onClick={() => navigator.clipboard.writeText(window.location.hostname)} className="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-50">複製</button>
                    </div>
                 </div>
               )}

               {showTutorial && (
                 <div className="text-sm text-gray-600 space-y-3 bg-gray-50 p-4 rounded-lg h-60 overflow-y-auto custom-scrollbar">
                    <p>1. 前往 <a href="https://console.firebase.google.com/" target="_blank" className="text-blue-600 underline">Firebase Console</a> 並建立新專案。</p>
                    <p>2. 進入專案設定 (Project Settings)，在 General 頁面下方點擊 "Web" 圖示 (&lt;/&gt; key) 註冊應用程式。</p>
                    <p>3. 複製 <code>firebaseConfig</code> 物件內容 (包含 apiKey, authDomain 等欄位)。</p>
                    <p>4. <strong className="text-gray-800">重要：</strong>前往 Authentication &gt; Settings &gt; Authorized domains，點擊 "Add domain"，將目前的網址 <code className="bg-yellow-100 px-1">{window.location.hostname}</code> 加入白名單。</p>
                    <p>5. 前往 Firestore Database &gt; Rules，將規則修改為：
                       <pre className="bg-gray-200 p-2 rounded mt-1 text-xs overflow-x-auto">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /shared_itineraries/{docId} {
      allow read: if true;
      allow create: if request.auth != null;
    }
  }
}`}
                       </pre>
                    </p>
                    <p>6. 將複製的 JSON 設定檔貼入下方欄位並儲存。</p>
                 </div>
               )}
            </div>

            <div className="mb-4">
                <label className="block text-sm font-bold mb-2">Firebase Config (JSON)</label>
                <textarea 
                  className="w-full h-32 border rounded p-2 text-xs font-mono" 
                  value={firebaseConfigStr}
                  onChange={(e) => setFirebaseConfigStr(e.target.value)}
                  placeholder='{ "apiKey": "...", ... }'
                />
            </div>
            <button onClick={handleSaveConfig} className="w-full bg-systemBlue text-white py-2 rounded font-bold mb-2">儲存設定</button>
            <button onClick={() => setIsSettingsOpen(false)} className="w-full bg-gray-100 py-2 rounded">關閉</button>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6">
                <h3 className="text-lg font-bold mb-4">新增地點</h3>
                <textarea className="w-full h-32 border p-3 rounded mb-4" value={addInput} onChange={(e) => setAddInput(e.target.value)} placeholder="輸入網址或文字..." />
                
                <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-500 mb-1">指定類別 (選填)</label>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => setAddCategory('AUTO')} className={`px-2 py-1 rounded text-xs border ${addCategory === 'AUTO' ? 'bg-black text-white' : 'bg-white'}`}>自動偵測</button>
                        <button onClick={() => setAddCategory(CategoryType.FOOD)} className={`px-2 py-1 rounded text-xs border ${addCategory === CategoryType.FOOD ? 'bg-blue-100 border-blue-300' : 'bg-white'}`}>美食</button>
                        <button onClick={() => setAddCategory(CategoryType.SIGHTSEEING)} className={`px-2 py-1 rounded text-xs border ${addCategory === CategoryType.SIGHTSEEING ? 'bg-green-100 border-green-green-300' : 'bg-white'}`}>景點</button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => addFileInputRef.current?.click()} className="flex-1 bg-white border border-gray-200 text-gray-700 py-2 rounded flex items-center justify-center gap-1 hover:bg-gray-50">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        圖片
                    </button>
                    <input type="file" ref={addFileInputRef} className="hidden" accept="image/*" onChange={handleAddImageUpload} />
                    
                    <button onClick={closeAddModal} className="flex-1 bg-gray-100 py-2 rounded hover:bg-gray-200">取消</button>
                    <button onClick={handleAppendAnalyze} disabled={isAdding} className="flex-1 bg-systemBlue text-white py-2 rounded hover:bg-blue-600 disabled:bg-gray-300">
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
