
import React, { useState, useEffect, useRef } from 'react';

interface AddDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAnalyze: (text: string) => Promise<void>;
  isLoading: boolean;
}

const AddDataModal: React.FC<AddDataModalProps> = ({ isOpen, onClose, onAnalyze, isLoading }) => {
  const [input, setInput] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clear input whenever the modal is opened
  useEffect(() => {
    if (isOpen) {
      setInput('');
      setSuccessMessage(null);
      setErrorMessage(null);
      // Give time for modal to render
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    if (input.trim()) {
      try {
        await onAnalyze(input.trim());
        
        // SUCCESS: Explicitly clear input immediately
        setInput('');
        setSuccessMessage('🎉 成功加入！您可以繼續輸入...');
        
        // Auto-clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(null), 3000);
        
        // Force focus back to textarea for continuous entry
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });

      } catch (e: any) {
        // ERROR: Keep input so user can fix it.
        setErrorMessage(e.message || "發生錯誤，請重試");
        textareaRef.current?.focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={isLoading ? undefined : onClose}
      ></div>

      {/* Modal Content */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up flex flex-col max-h-[90vh]">
        <div className="bg-gradient-to-r from-systemBlue to-cyan-600 px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-white font-bold text-lg flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            新增更多地點
          </h3>
          {!isLoading && (
            <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
          )}
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <p className="text-gray-600 text-sm mb-4">
            請貼上新的部落格連結或遊記文字，AI 將會把提取出的地點<b>合併</b>到目前的地圖中。
          </p>
          
          <textarea
            ref={textareaRef}
            className={`w-full h-64 p-4 text-base text-gray-800 placeholder-gray-400 bg-gray-50 border focus:ring-2 rounded-xl resize-none mb-2 ${errorMessage ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-gray-200 focus:border-systemBlue focus:ring-blue-100'}`}
            placeholder="在此貼上內容..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
          <div className="flex-1 mr-4">
             {successMessage && (
                 <span className="text-green-600 text-sm font-bold flex items-center gap-1 animate-fade-in">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                     {successMessage}
                 </span>
             )}
             {errorMessage && (
                 <span className="text-red-600 text-sm font-bold flex items-center gap-1 animate-fade-in">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                     {errorMessage}
                 </span>
             )}
          </div>
          <div className="flex gap-3">
            <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            >
                關閉
            </button>
            <button
                onClick={handleSubmit}
                disabled={!input.trim() || isLoading}
                className="px-6 py-2.5 text-sm font-bold text-white bg-systemBlue rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
            >
                {isLoading ? (
                    <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        處理中...
                    </>
                ) : (
                    '分析並加入'
                )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddDataModal;