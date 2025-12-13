import React, { useState, useEffect } from 'react';
import { useCurrency, FiatCurrency } from '../contexts/CurrencyContext';
import { useUser } from '../contexts/UserContext';
import { Monitor, DollarSign, Globe, Link as LinkIcon, Palette, Image as ImageIcon, Check, Waves, Minus, Server } from 'lucide-react';
import { Button } from './ui/Button';
import { SanctuaryLogo } from './ui/CustomIcons';
import { ThemeOption, BackgroundOption } from '../types';
import { themeRegistry } from '../themes';

export const Settings: React.FC = () => {
  const { showFiat, toggleShowFiat, fiatCurrency, setFiatCurrency, unit, setUnit, priceProvider, setPriceProvider, availableProviders, refreshPrice, priceLoading, lastPriceUpdate, btcPrice, currencySymbol } = useCurrency();
  const { user, updatePreferences } = useUser();

  // Prefs saving state
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [isSavingPersonalization, setIsSavingPersonalization] = useState(false);
  const [personalizationSaved, setPersonalizationSaved] = useState(false);

  const handleSavePreferences = async () => {
      setIsSavingPrefs(true);
      try {
        // updatePreferences already called by CurrencyContext hooks
        // This is just for visual feedback
        await new Promise(resolve => setTimeout(resolve, 500));
        setIsSavingPrefs(false);
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 2000);
      } catch (error) {
        console.error('Failed to save display preferences:', error);
        setIsSavingPrefs(false);
      }
  };

  const handleSavePersonalization = async () => {
      setIsSavingPersonalization(true);
      try {
        // updatePreferences already called by the theme/background/darkMode buttons
        // This is just for visual feedback
        await new Promise(resolve => setTimeout(resolve, 500));
        setIsSavingPersonalization(false);
        setPersonalizationSaved(true);
        setTimeout(() => setPersonalizationSaved(false), 2000);
      } catch (error) {
        console.error('Failed to save personalization:', error);
        setIsSavingPersonalization(false);
      }
  }

  // Theme Helpers
  const currentTheme = user?.preferences?.theme || 'sanctuary';
  const currentBg = user?.preferences?.background || 'zen';
  const isDark = user?.preferences?.darkMode || false;

  // Load themes dynamically from theme registry
  const themes = themeRegistry.getAllMetadata().map(theme => ({
    id: theme.id as ThemeOption,
    name: theme.name,
    color: theme.preview?.primaryColor || '#7d7870'
  }));

  // Icon mapping for background patterns
  const bgIconMap: Record<string, any> = {
    minimal: Minus,
    zen: ImageIcon,
    sanctuary: SanctuaryLogo,
    'sanctuary-hero': SanctuaryLogo,
    waves: Waves,
    lines: Minus,
    circuit: Server,
    topography: Globe,
  };

  // Load background patterns dynamically from theme registry
  const backgrounds = themeRegistry.getAllPatterns(currentTheme).map(pattern => ({
    id: pattern.id as BackgroundOption,
    name: pattern.name,
    icon: bgIconMap[pattern.id] || ImageIcon
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Customize your Sanctuary experience</p>
      </div>

      {/* Visual Customization */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
             <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
               <Palette className="w-5 h-5" />
             </div>
             <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Personalization</h3>
          </div>
        </div>
        
        <div className="p-6 space-y-6">
           {/* Color Theme */}
           <div>
              <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3 block">Color Theme</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                 {themes.map(theme => (
                    <button
                       key={theme.id}
                       onClick={() => updatePreferences({ theme: theme.id })}
                       className={`relative p-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${currentTheme === theme.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'}`}
                    >
                       <div className="w-4 h-4 rounded-full" style={{ backgroundColor: theme.color }}></div>
                       <span className="text-sm font-medium dark:text-sanctuary-200">{theme.name}</span>
                       {currentTheme === theme.id && <div className="absolute top-1 right-1 w-2 h-2 bg-primary-600 rounded-full"></div>}
                    </button>
                 ))}
              </div>
           </div>

           {/* Background Pattern */}
           <div>
              <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3 block">Background Pattern</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                 {backgrounds.map(bg => (
                    <button
                       key={bg.id}
                       onClick={() => updatePreferences({ background: bg.id })}
                       className={`relative p-3 rounded-xl border flex flex-col items-center justify-center text-center transition-all h-20 ${currentBg === bg.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'}`}
                    >
                       <bg.icon className={`w-5 h-5 mb-2 ${currentBg === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                       <span className={`text-[10px] font-medium ${currentBg === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>{bg.name}</span>
                    </button>
                 ))}
              </div>
           </div>

           {/* Dark Mode Toggle */}
           <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Dark Mode</span>
              <button 
                onClick={() => updatePreferences({ darkMode: !isDark })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isDark ? 'bg-primary-600' : 'bg-sanctuary-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDark ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
           </div>

           <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 flex justify-end">
             <Button onClick={handleSavePersonalization} isLoading={isSavingPersonalization} variant={personalizationSaved ? 'secondary' : 'primary'}>
                {personalizationSaved ? <><Check className="w-4 h-4 mr-2" /> Saved</> : 'Save Personalization'}
             </Button>
          </div>
        </div>
      </div>

      {/* Display Settings */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
             <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
               <Monitor className="w-5 h-5" />
             </div>
             <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Display Preferences</h3>
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Bitcoin Unit</label>
              <p className="text-sm text-sanctuary-500">Choose between Sats (Integers) or BTC (Decimal).</p>
            </div>
            <div className="flex items-center surface-secondary rounded-lg p-1">
               <button 
                  onClick={() => setUnit('sats')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'sats' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
               >
                 Sats
               </button>
               <button 
                  onClick={() => setUnit('btc')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${unit === 'btc' ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
               >
                 BTC
               </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="space-y-1">
              <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Show Fiat Equivalent</label>
              <p className="text-sm text-sanctuary-500">Display {fiatCurrency} value alongside Bitcoin amounts.</p>
            </div>
            <button 
              onClick={toggleShowFiat}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${showFiat ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${showFiat ? 'translate-x-7' : 'translate-x-1'}`}>
                 <DollarSign className={`w-4 h-4 m-1 ${showFiat ? 'text-primary-600' : 'text-sanctuary-400'}`} />
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
             <div className="space-y-1">
               <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Fiat Currency</label>
               <p className="text-sm text-sanctuary-500">Select your local currency.</p>
             </div>
             <div className="relative">
                <select 
                  value={fiatCurrency}
                  onChange={(e) => setFiatCurrency(e.target.value as FiatCurrency)}
                  className="appearance-none surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 py-2 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                   <option value="USD">USD ($)</option>
                   <option value="EUR">EUR (€)</option>
                   <option value="GBP">GBP (£)</option>
                   <option value="JPY">JPY (¥)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-sanctuary-500">
                   <Globe className="w-4 h-4" />
                </div>
             </div>
          </div>
          
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 flex justify-end">
             <Button onClick={handleSavePreferences} isLoading={isSavingPrefs} variant={prefsSaved ? 'secondary' : 'primary'}>
                {prefsSaved ? <><Check className="w-4 h-4 mr-2" /> Saved</> : 'Save Display Configuration'}
             </Button>
          </div>
        </div>
      </div>

      {/* External Services */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
             <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
               <Globe className="w-5 h-5" />
             </div>
             <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">External Services</h3>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Price Provider Settings */}
          <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <div className="space-y-1">
                   <label className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Price Provider</label>
                   <p className="text-xs text-sanctuary-500">Select which service to use for Bitcoin price data.</p>
                 </div>
                 <DollarSign className="w-4 h-4 text-sanctuary-400" />
              </div>
              <div>
                 <label className="block text-xs font-medium text-sanctuary-500 mb-1">Provider</label>
                 <select
                   value={priceProvider}
                   onChange={(e) => setPriceProvider(e.target.value)}
                   className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                 >
                   {availableProviders.map(provider => (
                     <option key={provider} value={provider}>
                       {provider === 'auto' ? 'Auto (Aggregated from all sources)' : provider.charAt(0).toUpperCase() + provider.slice(1)}
                     </option>
                   ))}
                 </select>
                 <p className="text-xs text-sanctuary-400 mt-2">
                   {priceProvider === 'auto'
                     ? 'Using aggregated prices from multiple sources for maximum reliability.'
                     : `Using ${priceProvider} as the exclusive price source.`}
                 </p>
              </div>

              {/* Current Price Display */}
              <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800 mt-4">
                 <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-sanctuary-500">Current Bitcoin Price</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={refreshPrice}
                      isLoading={priceLoading}
                    >
                      Refresh Price
                    </Button>
                 </div>
                 <div className="surface-muted rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
                    <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                       {btcPrice !== null
                         ? `${currencySymbol}${btcPrice.toLocaleString(undefined, {maximumFractionDigits: 0})}`
                         : '-----'}
                    </div>
                    {lastPriceUpdate && (
                      <div className="text-xs text-sanctuary-400 mt-1">
                         Last updated: {lastPriceUpdate.toLocaleTimeString()}
                      </div>
                    )}
                 </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
};
