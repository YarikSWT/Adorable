import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Sparkles, Package, LogOut, Wallet, Settings, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function Layout({ children, currentPageName }) {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  
  // Закрываем меню при клике вне его
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuOpen && !event.target.closest('.relative')) {
        setSettingsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [settingsMenuOpen]);
  
  // const { data: balanceData } = useQuery({
  //   queryKey: ['seedream-balance'],
  //   queryFn: async () => {
  //     const response = await base44.functions.invoke('getSeedDreamBalance');
  //     return response.data;
  //   },
  //   refetchInterval: 60000, // Refresh every minute
  //   retry: false,
  //   enabled: false // Disable automatic fetching to prevent 401 errors
  // });

  const handleLogout = () => {
    base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link to={createPageUrl('Orders')} className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Newborn AI Studio
                </h1>
                <p className="text-xs text-slate-500">Платформа генерации</p>
              </div>
            </Link>

            <nav className="flex items-center gap-6">
              <Link 
                to={createPageUrl('Orders')}
                className={`text-sm font-medium transition-colors ${
                  currentPageName === 'Orders' || currentPageName === 'CreateOrder' || currentPageName === 'OrderDetails'
                    ? 'text-slate-900' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Заказы
              </Link>
              <Link 
                to={createPageUrl('Templates')}
                className={`text-sm font-medium transition-colors flex items-center gap-2 ${
                  currentPageName === 'Templates'
                    ? 'text-slate-900' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Package className="w-4 h-4" />
                Шаблоны
              </Link>
              <div className="relative">
                <button
                  onClick={() => setSettingsMenuOpen(!settingsMenuOpen)}
                  className={`text-sm font-medium transition-colors flex items-center gap-2 ${
                    currentPageName === 'ArchiveMessageSettings' || currentPageName === 'AlbumSellingTextSettings'
                      ? 'text-slate-900' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  Настройки
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                {settingsMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 z-50">
                    <Link
                      to={createPageUrl('ArchiveMessageSettings')}
                      onClick={() => setSettingsMenuOpen(false)}
                      className={`block px-4 py-3 text-sm hover:bg-slate-50 transition-colors ${
                        currentPageName === 'ArchiveMessageSettings' ? 'bg-slate-50 text-slate-900' : 'text-slate-700'
                      }`}
                    >
                      Настройки приветственного сообщения
                    </Link>
                    <Link
                      to={createPageUrl('AlbumSellingTextSettings')}
                      onClick={() => setSettingsMenuOpen(false)}
                      className={`block px-4 py-3 text-sm hover:bg-slate-50 transition-colors ${
                        currentPageName === 'AlbumSellingTextSettings' ? 'bg-slate-50 text-slate-900' : 'text-slate-700'
                      }`}
                    >
                      Настройки текста для альбомов
                    </Link>
                  </div>
                )}
              </div>
              
              {/* {balanceData?.success && balanceData.balance && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-700">
                    {balanceData.balance.credits || balanceData.balance.amount || 'N/A'}
                  </span>
                </div>
              )} */}
              
              <button
                onClick={handleLogout}
                className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Выход
              </button>
            </nav>
          </div>
        </div>
      </header>
      
      <main>
        {children}
      </main>
    </div>
  );
}