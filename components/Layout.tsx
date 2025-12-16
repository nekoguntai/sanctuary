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
} from 'lucide-react';
import { SanctuaryLogo, getWalletIcon, getDeviceIcon } from './ui/CustomIcons';
import { WalletType, HardwareDevice } from '../types';
import { useUser } from '../contexts/UserContext';
import { getWallets, Wallet as ApiWallet } from '../src/api/wallets';
import { getDevices, Device as ApiDevice } from '../src/api/devices';
import { getDrafts } from '../src/api/drafts';
import * as bitcoinApi from '../src/api/bitcoin';
import { version } from '../package.json';
import { NotificationBell } from './NotificationPanel';
import { NotificationBadge } from './NotificationBadge';
import { useAppNotifications } from '../contexts/AppNotificationContext';
import { createLogger } from '../utils/logger';

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

  // Update expanded state when route changes
  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  // Data for Sidebar
  const [wallets, setWallets] = useState<ApiWallet[]>([]);
  const [devices, setDevices] = useState<ApiDevice[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const [w, d] = await Promise.all([
          getWallets(),
          getDevices()
        ]);
        setWallets(w);
        setDevices(d);

        // Fetch drafts for all wallets and add notifications
        for (const wallet of w) {
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
      } catch (error) {
        log.error('Failed to fetch sidebar data', { error });
      }
    };
    fetchData();
  }, [user]);

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
            <span className="text-xs text-sanctuary-400 ml-1">v{version}</span>
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
          <div className="py-8 px-4 sm:px-6 md:px-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};