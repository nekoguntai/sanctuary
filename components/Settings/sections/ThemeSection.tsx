import React, { useState } from 'react';
import { useUser } from '../../../contexts/UserContext';
import { Image as ImageIcon, Waves, Minus, Server, Globe, Palette, Sparkles, Shield, Bitcoin, Circle, Binary, Network, Flower2, Snowflake, Box, Calendar, Sun, Leaf, CloudSnow, Bug, Droplets, Flame, CloudRain, Fish, TreePine, Flower, Lamp, Cloud, Shell, Train, Mountain, Bird, Rabbit, Star, Sailboat, Wind, Haze, Bell, PartyPopper, Moon, TreeDeciduous, Contrast, Layers, Hash, Heart, Share2, Zap, Send, Search, X, ChevronDown } from 'lucide-react';
import { SanctuaryLogo, SatsIcon } from '../../ui/CustomIcons';
import { ThemeOption, BackgroundOption, SeasonalBackgrounds } from '../../../types';
import { Season } from '../../../themes';
import { CATEGORIES, BackgroundCategory, getBackgroundsByCategory } from '../../../themes/backgroundCategories';
import { themeRegistry } from '../../../themes';

const AppearanceTab: React.FC = () => {
  const { user, updatePreferences } = useUser();
  const [activeCategory, setActiveCategory] = useState<BackgroundCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [seasonalExpanded, setSeasonalExpanded] = useState(false);

  const currentTheme = user?.preferences?.theme || 'sanctuary';
  const currentBg = user?.preferences?.background || 'zen';
  const isDark = user?.preferences?.darkMode || false;
  const userSeasonalBgs = user?.preferences?.seasonalBackgrounds;
  const favoriteBackgrounds = user?.preferences?.favoriteBackgrounds || [];

  const themes = themeRegistry.getAllMetadata().map(theme => ({
    id: theme.id as ThemeOption,
    name: theme.name,
    color: theme.preview?.primaryColor || '#7d7870'
  }));

  const bgIconMap: Record<string, any> = {
    // Static patterns
    minimal: Minus,
    zen: ImageIcon,
    sanctuary: SanctuaryLogo,
    'sanctuary-hero': SanctuaryLogo,
    waves: Waves,
    lines: Minus,
    circuit: Server,
    topography: Globe,
    hexagons: Network,
    stars: Star,
    // Bitcoin-themed animations
    'sakura-petals': Flower2,
    'floating-shields': Shield,
    'bitcoin-particles': Bitcoin,
    'stacking-blocks': Box,
    'digital-rain': Binary,
    'constellation': Network,
    'sanctuary-logo': SanctuaryLogo,
    'sats-symbol': SatsIcon,
    // Weather & nature animations
    'snowfall': Snowflake,
    'fireflies': Bug,
    'ink-drops': Droplets,
    'rippling-water': Waves,
    'falling-leaves': Leaf,
    'embers-rising': Flame,
    'gentle-rain': CloudRain,
    'northern-lights': Sparkles,
    // Sumi-e (ink wash) animations
    'koi-shadows': Fish,
    'bamboo-sway': TreePine,
    // Zen & nature animations
    'lotus-bloom': Flower,
    'floating-lanterns': Lamp,
    'moonlit-clouds': Cloud,
    'tide-pools': Shell,
    // Fun animations
    'train-station': Train,
    'fireworks': PartyPopper,
    // Landscape animations
    'serene-meadows': TreeDeciduous,
    'still-ponds': Droplets,
    'desert-dunes': Sun,
    'mountain-mist': Mountain,
    'misty-valley': Haze,
    // Cute animals
    'duckling-parade': Bird,
    'bunny-meadow': Rabbit,
    // Night sky
    'stargazing': Star,
    // Serene animations
    'lavender-fields': Flower,
    'zen-sand-garden': Circle,
    'sunset-sailing': Sailboat,
    'raindrop-window': CloudRain,
    // Nature animations
    'butterfly-garden': Bug,
    'dandelion-wishes': Wind,
    'gentle-waves': Waves,
    // Additional serene animations
    'jellyfish-drift': Shell,
    'wind-chimes': Bell,
    'sakura-redux': Flower2,
    // New animations
    'hash-storm': Hash,
    'ice-crystals': Snowflake,
    'autumn-wind': Wind,
    // Abstract animations
    'smoke-calligraphy': Wind,
    'breath': Heart,
    'mycelium-network': Share2,
    'oil-slick': Palette,
    // New landscape/nature animations
    'bioluminescent-beach': Waves,
    'volcanic-islands': Mountain,
    'tidal-patterns': Shell,
    'eclipse': Moon,
    'paper-boats': Sailboat,
    'paper-airplanes': Send,
    'thunderstorm': Zap,
  };

  // Season icons for the time-based section
  const seasonIcons: Record<string, any> = {
    spring: Flower2,
    summer: Sun,
    fall: Leaf,
    winter: CloudSnow,
  };

  const currentSeason = themeRegistry.getCurrentSeason();
  const seasonalBackground = themeRegistry.getSeasonalBackground(userSeasonalBgs);

  // Get the configured or default background for a specific season
  const getSeasonBackground = (season: Season): string => {
    if (userSeasonalBgs?.[season]) {
      return userSeasonalBgs[season] as string;
    }
    return themeRegistry.getDefaultSeasonalBackground(season);
  };

  // Update a specific season's background
  const updateSeasonBackground = (season: Season, background: string) => {
    const newSeasonalBgs: SeasonalBackgrounds = {
      ...userSeasonalBgs,
      [season]: background as BackgroundOption,
    };
    updatePreferences({ seasonalBackgrounds: newSeasonalBgs });
  };

  const allPatterns = themeRegistry.getAllPatterns(currentTheme);

  const staticBackgrounds = allPatterns
    .filter(pattern => !pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || ImageIcon
    }));

  const animatedBackgrounds = allPatterns
    .filter(pattern => pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || Sparkles
    }));

  // All backgrounds combined for category filtering
  const allBackgrounds = [...staticBackgrounds, ...animatedBackgrounds];

  // Toggle a background as favorite
  const toggleFavorite = (bgId: BackgroundOption) => {
    const newFavorites = favoriteBackgrounds.includes(bgId)
      ? favoriteBackgrounds.filter(id => id !== bgId)
      : [...favoriteBackgrounds, bgId];
    updatePreferences({ favoriteBackgrounds: newFavorites });
  };

  // Filter backgrounds based on active category and search query
  const getFilteredBackgrounds = () => {
    let filtered: typeof allBackgrounds = [];

    if (activeCategory === 'all') {
      filtered = [...allBackgrounds];
    } else if (activeCategory === 'favorites') {
      filtered = allBackgrounds.filter(bg => favoriteBackgrounds.includes(bg.id));
    } else {
      const categoryBgIds = getBackgroundsByCategory(activeCategory);
      filtered = allBackgrounds.filter(bg => categoryBgIds.includes(bg.id));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(bg =>
        bg.name.toLowerCase().includes(query) ||
        bg.id.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  const filteredBackgrounds = getFilteredBackgrounds();

  return (
    <div className="space-y-6">
      {/* Color Theme */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Color Theme</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Choose a color scheme for your wallet</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {themes.map(theme => (
              <button
                key={theme.id}
                onClick={() => updatePreferences({ theme: theme.id })}
                className={`
                  relative rounded-lg border transition-all min-h-10 flex flex-col
                  ${currentTheme === theme.id
                    ? 'border-primary-500 ring-1 ring-primary-500 dark:ring-primary-400'
                    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
                  }
                `}
              >
                {/* Color bar at top */}
                <div className="h-1.5 w-full flex-shrink-0 rounded-t-lg" style={{ backgroundColor: theme.color }} />
                {/* Theme name */}
                <div className="px-1 py-0.5 flex-1 flex items-start justify-center">
                  <span className={`text-[10px] font-medium leading-tight text-center ${currentTheme === theme.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-600 dark:text-sanctuary-300'}`}>
                    {theme.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Backgrounds */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Backgrounds</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Select a background for your wallet</p>
        </div>
        <div className="p-6 space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search backgrounds..."
              className="w-full pl-10 pr-10 py-2.5 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(category => {
              const isActive = activeCategory === category.id;
              const count = category.id === 'favorites'
                ? favoriteBackgrounds.length
                : getBackgroundsByCategory(category.id).length;

              return (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`
                    inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${isActive
                      ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-700'
                      : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                    }
                  `}
                >
                  <span className="mr-1.5">{category.icon}</span>
                  <span>{category.label}</span>
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                    isActive
                      ? 'bg-primary-200 dark:bg-primary-800 text-primary-800 dark:text-primary-200'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Background Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {filteredBackgrounds.length === 0 ? (
              <div className="col-span-full py-8 text-center text-sanctuary-500">
                {activeCategory === 'favorites' && favoriteBackgrounds.length === 0 ? (
                  <div className="space-y-2">
                    <Heart className="w-8 h-8 mx-auto text-sanctuary-300 dark:text-sanctuary-600" />
                    <p className="text-sm">No favorites yet</p>
                    <p className="text-xs">Click the heart icon on any background to add it to your favorites</p>
                  </div>
                ) : searchQuery ? (
                  <p className="text-sm">No backgrounds match "{searchQuery}"</p>
                ) : (
                  <p className="text-sm">No backgrounds in this category</p>
                )}
              </div>
            ) : (
              filteredBackgrounds.map(bg => {
                const isAnimated = animatedBackgrounds.some(ab => ab.id === bg.id);
                const isFavorite = favoriteBackgrounds.includes(bg.id);

                return (
                  <div
                    key={bg.id}
                    className={`
                      relative rounded-xl border transition-all h-20 group
                      ${currentBg === bg.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
                      }
                    `}
                  >
                    {/* Main button area */}
                    <button
                      onClick={() => updatePreferences({ background: bg.id })}
                      className="w-full h-full p-3 flex flex-col items-center justify-center text-center"
                    >
                      <bg.icon className={`w-5 h-5 mb-2 ${currentBg === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                      <span className={`text-[10px] font-medium ${currentBg === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>
                        {bg.name}
                      </span>
                    </button>

                    {/* Animated indicator */}
                    {isAnimated && (
                      <span className="absolute top-1 left-1">
                        <Sparkles className="w-3 h-3 text-primary-400" />
                      </span>
                    )}

                    {/* Favorite button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(bg.id);
                      }}
                      className={`
                        absolute top-1 right-1 p-1 rounded-full transition-all
                        ${isFavorite
                          ? 'text-rose-500'
                          : 'text-sanctuary-300 dark:text-sanctuary-600 opacity-0 group-hover:opacity-100 hover:text-rose-400'
                        }
                      `}
                      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Time-Based / Seasonal - Collapsible */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            {/* Collapsible Header with Toggle */}
            <div className="flex items-center justify-between p-3 -mx-3 rounded-xl hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors">
              <button
                onClick={() => setSeasonalExpanded(!seasonalExpanded)}
                className="flex items-center space-x-2 flex-1"
              >
                <Calendar className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Seasonal Backgrounds</span>
                {!seasonalExpanded && (
                  <span className="text-xs text-sanctuary-500 ml-2">
                    {themeRegistry.getSeasonName()} · {animatedBackgrounds.find(b => b.id === seasonalBackground)?.name || seasonalBackground}
                  </span>
                )}
              </button>
              <div className="flex items-center space-x-3">
                {/* Enable/Disable Toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const isCurrentlySeasonal = currentBg === seasonalBackground;
                    updatePreferences({
                      background: (isCurrentlySeasonal ? 'minimal' : seasonalBackground) as BackgroundOption
                    });
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    currentBg === seasonalBackground
                      ? 'bg-primary-500'
                      : 'bg-sanctuary-300 dark:bg-sanctuary-600'
                  }`}
                  title={currentBg === seasonalBackground ? 'Disable seasonal background' : 'Enable seasonal background'}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      currentBg === seasonalBackground ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <button
                  onClick={() => setSeasonalExpanded(!seasonalExpanded)}
                  className="p-1"
                >
                  <ChevronDown className={`w-4 h-4 text-sanctuary-400 transition-transform ${seasonalExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            {/* Collapsible Content */}
            {seasonalExpanded && (
              <div className="mt-3 space-y-4">
                {/* Current Season Info */}
                <div className="flex items-center p-3 surface-secondary rounded-xl">
                  <div className="flex items-center space-x-3">
                    {(() => {
                      const SeasonIcon = seasonIcons[currentSeason];
                      return <SeasonIcon className="w-5 h-5 text-primary-500" />;
                    })()}
                    <div>
                      <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                        Current Season: {themeRegistry.getSeasonName()}
                      </div>
                      <div className="text-xs text-sanctuary-500">
                        Background: {animatedBackgrounds.find(b => b.id === seasonalBackground)?.name || seasonalBackground}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Season Configuration */}
                <div className="space-y-3">
                  <p className="text-xs text-sanctuary-500">Configure which animated background appears for each season:</p>
                  {(['spring', 'summer', 'fall', 'winter'] as const).map(season => {
                    const SeasonIcon = seasonIcons[season];
                    const isCurrentSeason = season === currentSeason;
                    const currentSeasonBg = getSeasonBackground(season);
                    const seasonNames: Record<Season, string> = {
                      spring: 'Spring',
                      summer: 'Summer',
                      fall: 'Autumn',
                      winter: 'Winter',
                    };

                    return (
                      <div
                        key={season}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                          isCurrentSeason
                            ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/30'
                            : 'border-sanctuary-200 dark:border-sanctuary-700'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <SeasonIcon className={`w-5 h-5 ${isCurrentSeason ? 'text-primary-500' : 'text-sanctuary-400'}`} />
                          <span className={`text-sm font-medium ${isCurrentSeason ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-700 dark:text-sanctuary-300'}`}>
                            {seasonNames[season]}
                            {isCurrentSeason && <span className="ml-2 text-xs text-primary-500">(current)</span>}
                          </span>
                        </div>
                        <select
                          value={currentSeasonBg}
                          onChange={(e) => updateSeasonBackground(season, e.target.value)}
                          className="text-sm bg-transparent border border-sanctuary-300 dark:border-sanctuary-600 rounded-lg px-3 py-1.5 text-sanctuary-700 dark:text-sanctuary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {animatedBackgrounds.map(bg => (
                            <option key={bg.id} value={bg.id}>
                              {bg.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Visual Settings */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Visual Settings</h3>
          <p className="text-sm text-sanctuary-500 mt-1">Adjust appearance settings</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Dark Mode Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Dark Mode</span>
            <button
              onClick={() => updatePreferences({ darkMode: !isDark })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isDark ? 'bg-primary-600' : 'bg-sanctuary-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${isDark ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Background Contrast */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Contrast className="w-4 h-4 text-sanctuary-500" />
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Background Contrast</span>
              </div>
              <span className="text-xs text-sanctuary-500">
                {(() => {
                  const level = user?.preferences?.contrastLevel ?? 0;
                  if (level === 0) return 'Default';
                  if (level === -2) return 'Much lighter';
                  if (level === -1) return 'Lighter';
                  if (level === 1) return 'Darker';
                  if (level === 2) return 'Much darker';
                  return 'Default';
                })()}
              </span>
            </div>
            <input
              type="range"
              min="-2"
              max="2"
              step="1"
              value={user?.preferences?.contrastLevel ?? 0}
              onChange={(e) => updatePreferences({ contrastLevel: parseInt(e.target.value, 10) })}
              className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
            />
          </div>

          {/* Pattern Visibility */}
          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-sanctuary-500" />
                <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Pattern Visibility</span>
              </div>
              <span className="text-xs text-sanctuary-500 font-mono">
                {(user?.preferences?.patternOpacity ?? 50) === 0
                  ? 'Hidden'
                  : (user?.preferences?.patternOpacity ?? 50) === 50
                  ? 'Default'
                  : `${user?.preferences?.patternOpacity ?? 50}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={user?.preferences?.patternOpacity ?? 50}
              onChange={(e) => updatePreferences({ patternOpacity: parseInt(e.target.value, 10) })}
              className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export { AppearanceTab };
