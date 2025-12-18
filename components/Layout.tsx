import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Wallet as WalletIcon,
  Settings,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  Cpu,
  Users,
  ChevronDown,
  ChevronRight,
  UserCircle,
  Server,
  Shield,
  Cog,
  Database,
  FileText,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import { SanctuaryLogo, getWalletIcon, getDeviceIcon } from './ui/CustomIcons';
import { WalletType, HardwareDevice } from '../types';
import { useUser } from '../contexts/UserContext';
import { Wallet as ApiWallet } from '../src/api/wallets';
import { Device as ApiDevice } from '../src/api/devices';
import { getDrafts } from '../src/api/drafts';
import { useWallets } from '../hooks/queries/useWallets';
import { useDevices } from '../hooks/queries/useDevices';
import * as bitcoinApi from '../src/api/bitcoin';
import { version } from '../package.json';
import { NotificationBell } from './NotificationPanel';
import { NotificationBadge } from './NotificationBadge';
import { useAppNotifications } from '../contexts/AppNotificationContext';
import { createLogger } from '../utils/logger';
import * as adminApi from '../src/api/admin';
import { ExternalLink, Github, Heart, Zap, Copy, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const log = createLogger('Layout');

interface LayoutProps {
  children: React.ReactNode;
  darkMode: boolean;
  toggleTheme: () => void;
  onLogout: () => void;
}

const NavItem = ({
  to,
  icon: Icon,
  label,
  hasSubmenu = false,
  isOpen = false,
  onToggle
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hasSubmenu?: boolean;
  isOpen?: boolean;
  onToggle?: (e: React.MouseEvent) => void;
}) => {
  const location = useLocation();
  const isActive = to === '/' 
    ? location.pathname === '/' 
    : location.pathname.startsWith(to);
  
  return (
    <div className={`group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${isActive ? 'bg-primary-50 dark:bg-sanctuary-800' : 'hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'} text-sanctuary-600 dark:text-sanctuary-400`}>
      <Link
        to={to}
        className={`flex-1 flex items-center ${isActive ? 'text-primary-700 dark:text-primary-500 font-semibold' : ''}`}
      >
        <Icon className={`mr-3 h-5 w-5 transition-colors ${isActive ? 'text-primary-600 dark:text-primary-500' : 'text-sanctuary-400 dark:text-sanctuary-500'}`} />
        {label}
      </Link>
      {hasSubmenu && (
        <button 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onToggle) onToggle(e);
          }}
          className="p-1 rounded-md hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
};

interface SubNavItemProps {
  to: string;
  label: string;
  icon?: React.ReactNode;
  activeColorClass?: string;
  badgeCount?: number;
  badgeSeverity?: 'info' | 'warning' | 'critical';
}

const SubNavItem: React.FC<SubNavItemProps> = ({ to, label, icon, activeColorClass, badgeCount, badgeSeverity }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`group flex items-center justify-between pl-8 pr-3 py-2 text-sm font-medium transition-all duration-200 border-l-2 ml-3 min-w-0 ${
        isActive
          ? `border-primary-500 dark:border-primary-500 text-primary-700 dark:text-primary-400 ${activeColorClass || ''}`
          : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-500 dark:text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300'
      }`}
      title={label}
    >
      <span className="flex items-center min-w-0">
        {icon && <span className="mr-2 opacity-70 flex-shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {(badgeCount ?? 0) > 0 && (
        <NotificationBadge count={badgeCount!} severity={badgeSeverity || 'warning'} size="sm" />
      )}
    </Link>
  );
};

export const Layout: React.FC<LayoutProps> = ({ children, darkMode, toggleTheme }) => {
  const { user, logout } = useUser();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { getWalletCount, getDeviceCount, addNotification, removeNotificationsByType } = useAppNotifications();

  // Auto-expand sections based on current route
  const getExpandedState = (pathname: string) => {
    // Check if viewing a specific wallet (not just /wallets list)
    const isInWalletDetail = pathname.match(/^\/wallets\/[^/]+/);
    // Check if viewing a specific device (not just /devices list)
    const isInDeviceDetail = pathname.match(/^\/devices\/[^/]+/);
    // Check if viewing any admin subpage
    const isInAdmin = pathname.startsWith('/admin/');

    return {
      wallets: !!isInWalletDetail,
      devices: !!isInDeviceDetail,
      admin: isInAdmin,
    };
  };

  const [expanded, setExpanded] = useState(() => getExpandedState(location.pathname));

  // Version modal state
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  // Update expanded state when route changes
  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  // Data for Sidebar - using React Query for automatic updates
  const { data: wallets = [] } = useWallets();
  const { data: devices = [] } = useDevices();

  // Handle version click
  const handleVersionClick = async () => {
    setShowVersionModal(true);
    if (!versionInfo) {
      setVersionLoading(true);
      try {
        const info = await adminApi.checkVersion();
        setVersionInfo(info);
      } catch (error) {
        log.error('Failed to check version', { error });
      } finally {
        setVersionLoading(false);
      }
    }
  };

  // Copy address to clipboard
  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(type);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (error) {
      log.error('Failed to copy to clipboard', { error });
    }
  };

  // Fetch drafts for notifications when wallets change
  useEffect(() => {
    if (!user || wallets.length === 0) return;

    const fetchDrafts = async () => {
      for (const wallet of wallets) {
        try {
          const drafts = await getDrafts(wallet.id);
          if (drafts.length > 0) {
            addNotification({
              type: 'pending_drafts',
              scope: 'wallet',
              scopeId: wallet.id,
              severity: 'warning',
              title: `${drafts.length} pending draft${drafts.length > 1 ? 's' : ''}`,
              message: `${wallet.name}: Resume or broadcast`,
              count: drafts.length,
              actionUrl: `/wallets/${wallet.id}`,
              actionLabel: 'View Drafts',
              dismissible: true,
              persistent: false,
            });
          } else {
            removeNotificationsByType('pending_drafts', wallet.id);
          }
        } catch (err) {
          // Non-critical - continue with other wallets
        }
      }
    };

    fetchDrafts();
  }, [user, wallets]);

  // Check Electrum/Bitcoin connection status periodically
  useEffect(() => {
    if (!user) return;

    const isAdmin = user.isAdmin;

    const checkConnection = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (status.connected) {
          // Connection is good - remove any existing error notification
          removeNotificationsByType('connection_error');
        } else {
          // Connection failed - not dismissible until resolved
          addNotification({
            type: 'connection_error',
            scope: 'global',
            severity: 'critical',
            title: 'Electrum server unreachable',
            message: status.error || 'Unable to connect to blockchain. Wallet data may be outdated.',
            // Only show admin action if user is admin
            ...(isAdmin && {
              actionUrl: '/admin/node',
              actionLabel: 'Configure Node',
            }),
            dismissible: false,
            persistent: false,
          });
        }
      } catch (error) {
        // API call itself failed - likely server issue
        addNotification({
          type: 'connection_error',
          scope: 'global',
          severity: 'critical',
          title: 'Connection error',
          message: 'Unable to check blockchain status. Server may be unavailable.',
          // Only show admin action if user is admin
          ...(isAdmin && {
            actionUrl: '/admin/node',
            actionLabel: 'Configure Node',
          }),
          dismissible: false,
          persistent: false,
        });
      }
    };

    // Check immediately on mount
    checkConnection();

    // Check every 60 seconds
    const interval = setInterval(checkConnection, 60000);

    return () => clearInterval(interval);
  }, [user, addNotification, removeNotificationsByType]);

  const toggleSection = (section: 'wallets' | 'devices' | 'admin') => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const sidebarContent = (
    <>
      <div className="flex items-center h-20 flex-shrink-0 px-6 border-b border-sanctuary-200 dark:border-sanctuary-800">
        <SanctuaryLogo className="h-8 w-8 text-primary-700 dark:text-primary-500 mr-3" />
        <span className="text-xl font-light tracking-wide text-sanctuary-800 dark:text-sanctuary-200">Sanctuary</span>
      </div>
      
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" />
        
        {/* Wallets Section */}
        <div className="space-y-1 pt-2">
          <NavItem 
            to="/wallets" 
            icon={WalletIcon} 
            label="Wallets" 
            hasSubmenu 
            isOpen={expanded.wallets} 
            onToggle={(e) => toggleSection('wallets')}
          />
          {expanded.wallets && (
            <div className="animate-fade-in-up space-y-0.5 mb-2">
              {wallets.length === 0 && (
                 <div className="pl-11 py-2 text-xs text-sanctuary-400 italic">No wallets created</div>
              )}
              {[...wallets].sort((a, b) => a.name.localeCompare(b.name)).map(w => {
                const isMultisig = w.type === 'multi_sig' || w.type === WalletType.MULTI_SIG;
                const walletType = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;
                // Use semantic colors (success/warning) to respect theme settings
                const activeColor = isMultisig ? 'text-warning-700 dark:text-warning-400' : 'text-success-700 dark:text-success-400';
                const walletNotifCount = getWalletCount(w.id);
                return (
                  <SubNavItem
                    key={w.id}
                    to={`/wallets/${w.id}`}
                    label={w.name}
                    icon={getWalletIcon(walletType, `w-3 h-3 ${isMultisig ? 'text-warning-500' : 'text-success-500'}`)}
                    activeColorClass={activeColor}
                    badgeCount={walletNotifCount}
                    badgeSeverity="warning"
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Devices Section */}
        <div className="space-y-1 pt-2">
           <NavItem 
              to="/devices" 
              icon={Cpu} 
              label="Devices" 
              hasSubmenu 
              isOpen={expanded.devices} 
              onToggle={(e) => toggleSection('devices')}
            />
            {expanded.devices && (
              <div className="animate-fade-in-up space-y-0.5 mb-2">
                 {devices.length === 0 && (
                    <div className="pl-11 py-2 text-xs text-sanctuary-400 italic">No devices connected</div>
                 )}
                 {[...devices].sort((a, b) => a.label.localeCompare(b.label)).map(d => {
                   const deviceNotifCount = getDeviceCount(d.id);
                   return (
                     <SubNavItem
                       key={d.id}
                       to={`/devices/${d.id}`}
                       label={d.label}
                       icon={getDeviceIcon(d.type, "w-3 h-3 text-sanctuary-400")}
                       badgeCount={deviceNotifCount}
                       badgeSeverity="warning"
                     />
                   );
                 })}
              </div>
            )}
        </div>

        <div className="pt-6 pb-2">
          <div className="px-4 text-xs font-semibold text-sanctuary-400 uppercase tracking-wider">
            System
          </div>
        </div>
        <NavItem to="/account" icon={UserCircle} label="Account" />
        {user?.isAdmin && (
          <div className="space-y-1 pt-2">
            <NavItem
              to="/admin"
              icon={Shield}
              label="Administration"
              hasSubmenu
              isOpen={expanded.admin}
              onToggle={() => toggleSection('admin')}
            />
            {expanded.admin && (
              <div className="animate-fade-in-up space-y-0.5 mb-2">
                <SubNavItem
                  to="/admin/node-config"
                  label="Node Config"
                  icon={<Server className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/settings"
                  label="System Settings"
                  icon={<Cog className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/users-groups"
                  label="Users & Groups"
                  icon={<Users className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/backup"
                  label="Backup & Restore"
                  icon={<Database className="w-3 h-3" />}
                />
                <SubNavItem
                  to="/admin/audit-logs"
                  label="Audit Logs"
                  icon={<FileText className="w-3 h-3" />}
                />
              </div>
            )}
          </div>
        )}
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </nav>

      <div className="flex-shrink-0 border-t border-sanctuary-200 dark:border-sanctuary-800 p-4">
        <div className="flex items-center w-full justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationBell />
            <button
              onClick={handleVersionClick}
              className="text-xs text-sanctuary-400 ml-1 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors cursor-pointer"
              title="Version info & support"
            >
              v{version}
            </button>
          </div>
          <div className="flex items-center">
             <span className="text-xs font-medium text-sanctuary-500 mr-3">{user?.username}</span>
             <button
                onClick={logout}
                className="p-2 rounded-lg text-sanctuary-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                title="Logout"
             >
                <LogOut className="h-5 w-5" />
             </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden text-sanctuary-900 dark:text-sanctuary-100 transition-colors duration-500">
      
      {/* Sidebar Desktop - Uses Sanctuary 900 which is now correctly defined as Dark Gray in index.html */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col h-0 flex-1 border-r border-sanctuary-200 dark:border-sanctuary-800 surface-elevated">
            {sidebarContent}
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="flex flex-col flex-1 w-0 overflow-hidden bg-transparent">
        <div className="md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 surface-elevated border-b border-sanctuary-200 dark:border-sanctuary-800 flex justify-between items-center px-4 h-16">
            <div className="flex items-center">
              <SanctuaryLogo className="h-6 w-6 text-primary-700 dark:text-primary-500 mr-2" />
              <span className="text-lg font-light text-sanctuary-800 dark:text-sanctuary-200">Sanctuary</span>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-sanctuary-500 hover:text-sanctuary-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
            >
              <span className="sr-only">Open sidebar</span>
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setIsMobileMenuOpen(false)}></div>
            <div className="relative flex-1 flex flex-col max-w-xs w-full surface-elevated">
               {sidebarContent}
            </div>
          </div>
        )}

        <main className="flex-1 relative overflow-y-auto focus:outline-none">
          {/* Default Password Warning Banner - only for admin user */}
          {user?.isAdmin && user?.usingDefaultPassword && (
            <div className="bg-amber-500 dark:bg-amber-600">
              <div className="max-w-7xl mx-auto py-2 px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between flex-wrap">
                  <div className="flex-1 flex items-center">
                    <span className="flex p-1 rounded-lg bg-amber-600 dark:bg-amber-700">
                      <AlertTriangle className="h-5 w-5 text-white" />
                    </span>
                    <p className="ml-3 font-medium text-white text-sm">
                      <span>Security Warning: You are using the default password.</span>
                      <Link
                        to="/account"
                        className="ml-2 underline hover:text-amber-100 font-semibold"
                      >
                        Change it now →
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="py-8 px-4 sm:px-6 md:px-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Version Info Modal */}
      {showVersionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowVersionModal(false)}
          />
          <div className="relative surface-elevated rounded-2xl shadow-2xl border border-sanctuary-200 dark:border-sanctuary-700 max-w-md w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-sanctuary-200 dark:border-sanctuary-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <SanctuaryLogo className="h-8 w-8 text-primary-600 dark:text-primary-400" />
                  <div>
                    <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-50">
                      Sanctuary
                    </h2>
                    <p className="text-sm text-sanctuary-500">
                      v{version}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVersionModal(false)}
                  className="p-2 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Update Status */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide">
                  Version Status
                </h3>
                {versionLoading ? (
                  <div className="flex items-center space-x-2 text-sanctuary-500">
                    <div className="animate-spin h-4 w-4 border-2 border-sanctuary-300 border-t-sanctuary-600 rounded-full" />
                    <span className="text-sm">Checking for updates...</span>
                  </div>
                ) : versionInfo?.updateAvailable ? (
                  <div className="p-3 rounded-lg bg-success-50 dark:bg-success-900/30 border border-success-200 dark:border-success-700">
                    <div className="flex items-center space-x-2 text-success-700 dark:text-success-300">
                      <Zap className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Update available: v{versionInfo.latestVersion}
                      </span>
                    </div>
                    {versionInfo.releaseName && (
                      <p className="text-xs text-success-600 dark:text-success-400 mt-1">
                        {versionInfo.releaseName}
                      </p>
                    )}
                    <a
                      href={versionInfo.releaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 text-xs text-success-700 dark:text-success-300 hover:underline mt-2"
                    >
                      <span>View release notes</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg surface-secondary">
                    <div className="flex items-center space-x-2 text-sanctuary-600 dark:text-sanctuary-400">
                      <Check className="h-4 w-4 text-success-500" />
                      <span className="text-sm">You're running the latest version</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Links */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide">
                  Project
                </h3>
                <div className="space-y-2">
                  <a
                    href="https://github.com/n-narusegawa/sanctuary"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg surface-secondary hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <Github className="h-5 w-5 text-sanctuary-600 dark:text-sanctuary-400" />
                      <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                        GitHub Repository
                      </span>
                    </div>
                    <ExternalLink className="h-4 w-4 text-sanctuary-400" />
                  </a>
                  <a
                    href="https://github.com/n-narusegawa/sanctuary/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg surface-secondary hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <FileText className="h-5 w-5 text-sanctuary-600 dark:text-sanctuary-400" />
                      <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                        Release Notes
                      </span>
                    </div>
                    <ExternalLink className="h-4 w-4 text-sanctuary-400" />
                  </a>
                </div>
              </div>

              {/* Support / Donations */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide flex items-center space-x-1">
                  <Heart className="h-4 w-4 text-rose-500" />
                  <span>Support This Project</span>
                </h3>
                <p className="text-xs text-sanctuary-500">
                  Sanctuary is free and open source. If you find it useful, consider supporting development.
                </p>
                <div className="space-y-3 mt-3">
                  {/* Bitcoin Address */}
                  <div className="p-3 rounded-lg surface-secondary">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-sanctuary-500 uppercase">Bitcoin</span>
                      <button
                        onClick={() => copyToClipboard('bc1qzmc3dq08dermpth02xa437d3fx99n7e6wyhmhq', 'btc')}
                        className="flex items-center space-x-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        {copiedAddress === 'btc' ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="bg-white p-1.5 rounded-lg flex-shrink-0">
                        <QRCodeSVG value="bitcoin:bc1qzmc3dq08dermpth02xa437d3fx99n7e6wyhmhq" size={64} level="L" />
                      </div>
                      <code className="text-xs text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono">
                        bc1qzmc3dq08dermpth02xa437d3fx99n7e6wyhmhq
                      </code>
                    </div>
                  </div>

                  {/* Lightning Address */}
                  <div className="p-3 rounded-lg surface-secondary">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-sanctuary-500 uppercase flex items-center space-x-1">
                        <Zap className="h-3 w-3 text-amber-500" />
                        <span>Lightning Address</span>
                      </span>
                      <button
                        onClick={() => copyToClipboard('sanctuary@getalby.com', 'ln')}
                        className="flex items-center space-x-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        {copiedAddress === 'ln' ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="bg-white p-1.5 rounded-lg flex-shrink-0">
                        <QRCodeSVG value="lightning:sanctuary@getalby.com" size={64} level="L" />
                      </div>
                      <code className="text-xs text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono">
                        sanctuary@getalby.com
                      </code>
                    </div>
                  </div>

                  {/* BOLT12 Offer */}
                  <div className="p-3 rounded-lg surface-secondary">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-sanctuary-500 uppercase flex items-center space-x-1">
                        <Zap className="h-3 w-3 text-amber-500" />
                        <span>BOLT12 Offer</span>
                      </span>
                      <button
                        onClick={() => copyToClipboard('lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy', 'bolt12')}
                        className="flex items-center space-x-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        {copiedAddress === 'bolt12' ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-start space-x-3">
                      <div className="bg-white p-1.5 rounded-lg flex-shrink-0">
                        <QRCodeSVG value="lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy" size={64} level="L" />
                      </div>
                      <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono leading-tight">
                        lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-sanctuary-200 dark:border-sanctuary-800 text-center">
              <p className="text-xs text-sanctuary-400">
                Made with ❤️ for Bitcoin self-custody
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};