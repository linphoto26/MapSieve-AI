
import React, { useState, useRef, useEffect } from 'react';
import { Place } from '../types';
import { createChatSession } from '../services/geminiService';
import { Chat, GenerateContentResponse } from '@google/genai';

interface ChatWidgetProps {
  places: Place[];
  apiKey: string;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ places, apiKey }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'init', role: 'model', text: '你好！我是你的 AI 旅遊顧問。關於這份行程清單，有什麼我可以幫你的嗎？' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatSession = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset chat when places change significantly, or just init once
    if (places.length > 0 && apiKey) {
      try {
        chatSession.current = createChatSession(places, apiKey);
        setMessages([{ id: 'init', role: 'model', text: '你好！我是你的 AI 旅遊顧問。關於這份行程清單，有什麼我可以幫你的嗎？' }]);
      } catch (e) {
        console.warn("Chat session failed to initialize:", e);
        chatSession.current = null;
        setMessages([{ id: 'error', role: 'model', text: '⚠️ 無法啟動 AI 顧問 (API Key 錯誤)。請檢查設定後重試。' }]);
      }
    } else if (!apiKey) {
      setMessages([{ id: 'no-key', role: 'model', text: '⚠️ 請先點擊右上角設定 API Key 才能使用聊天功能。' }]);
    }
  }, [places, apiKey]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    if (!chatSession.current) {
        if (!apiKey) {
           setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: '⚠️ 請先設定 API Key。' }]);
        } else {
           setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: '⚠️ 聊天功能目前無法使用。' }]);
        }
        return;
    }

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      // Use sendMessageStream for better UX, or just sendMessage for simplicity.
      // Using simple sendMessage here to keep dependencies light.
      const response: GenerateContentResponse = await chatSession.current.sendMessage({ message: userMsg });
      const text = response.text;
      
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: text || '抱歉，我現在無法回答。' }]);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: '發生錯誤，請稍後再試。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (places.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end pointer-events-none">
      
      {/* Chat Window */}
      <div 
        className={`
          pointer-events-auto bg-white/80 backdrop-blur-xl border border-white/50 shadow-2xl rounded-2xl w-[calc(100vw-32px)] sm:w-96 flex flex-col transition-all duration-300 origin-bottom-right mb-4 overflow-hidden
          ${isOpen ? 'opacity-100 scale-100 h-[500px] max-h-[80vh]' : 'opacity-0 scale-90 h-0'}
        `}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-systemBlue to-systemTeal p-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold text-sm">AI 旅遊顧問</span>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white p-1 rounded-full hover:bg-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-gray-50/50 scrollbar-thin">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`
                  max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm
                  ${msg.role === 'user' 
                    ? 'bg-systemBlue text-white rounded-br-none' 
                    : 'bg-white text-gray-700 border border-gray-100 rounded-bl-none'
                  }
                `}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
               <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex gap-1">
                 <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                 <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                 <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
               </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-gray-100 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="問問關於這些地點的問題..."
              className="w-full bg-gray-100 border-none rounded-full py-2 pl-4 pr-10 text-base sm:text-sm focus:ring-2 focus:ring-systemBlue/50"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-1 top-1 p-1.5 bg-systemBlue text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:bg-gray-400 transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          pointer-events-auto group flex items-center justify-center w-14 h-14 rounded-full shadow-mac-active transition-all duration-300
          ${isOpen ? 'bg-gray-200 rotate-90 text-gray-500' : 'bg-systemBlue text-white hover:scale-110'}
        `}
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
        
        {!isOpen && (
            <span className="absolute right-full mr-4 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                AI 旅遊顧問
            </span>
        )}
      </button>
    </div>
  );
};

export default ChatWidget;
