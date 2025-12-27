import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { WalletList } from './components/WalletList';
import { WalletDetail } from './components/WalletDetail';
import { SendTransactionPage } from './components/send';
import { CreateWallet } from './components/CreateWallet';
import { ImportWallet } from './components/ImportWallet';
import { DeviceList } from './components/DeviceList';
import { DeviceDetail } from './components/DeviceDetail';
import { ConnectDevice } from './components/ConnectDevice';
import { Settings } from './components/Settings';
import { Account } from './components/Account';
import { NodeConfig } from './components/NodeConfig';
import { UsersGroups } from './components/UsersGroups';
import { SystemSettings } from './components/SystemSettings';
import { Variables } from './components/Variables';
import { BackupRestore } from './components/BackupRestore';
import { AuditLogs } from './components/AuditLogs';
import AISettings from './components/AISettings';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { UserProvider, useUser } from './contexts/UserContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { AppNotificationProvider } from './contexts/AppNotificationContext';
import { SidebarProvider } from './contexts/SidebarContext';
import { NotificationContainer } from './components/NotificationToast';
import { useNotifications } from './contexts/NotificationContext';
import { QueryProvider } from './providers/QueryProvider';
import { useWebSocketQueryInvalidation } from './hooks/useWebSocket';
import * as authApi from './src/api/auth';
import { createLogger } from './utils/logger';

const log = createLogger('App');

const AppRoutes: React.FC = () => {
  const { isAuthenticated, logout, user, updatePreferences } = useUser();
  const { notifications, removeNotification } = useNotifications();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Invalidate React Query cache when WebSocket events are received
  // This ensures Dashboard pending transactions update immediately
  useWebSocketQueryInvalidation();

  // Check if user is using default password and show modal
  useEffect(() => {
    if (isAuthenticated && user?.usingDefaultPassword) {
      setShowPasswordModal(true);
    }
  }, [isAuthenticated, user?.usingDefaultPassword]);

  const handlePasswordChanged = async () => {
    // Refresh user data to clear the usingDefaultPassword flag
    try {
      const updatedUser = await authApi.getCurrentUser();
      // The user context will be updated, and the modal will close
      setShowPasswordModal(false);
      // Force a page reload to ensure all user data is fresh
      window.location.reload();
    } catch (error) {
      log.error('Failed to refresh user data', { error });
      // Still close the modal on success
      setShowPasswordModal(false);
      window.location.reload();
    }
  };

  if (!isAuthenticated) {
    return <Login />;
  }

  const isDarkMode = user?.preferences?.darkMode || false;
  const toggleTheme = () => {
    updatePreferences({ darkMode: !isDarkMode });
  };

  return (
    <>
      <Layout darkMode={isDarkMode} toggleTheme={toggleTheme} onLogout={logout}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wallets" element={<WalletList />} />
          <Route path="/wallets/create" element={<CreateWallet />} />
          <Route path="/wallets/import" element={<ImportWallet />} />
          <Route path="/wallets/:id" element={<WalletDetail />} />
          <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
          <Route path="/devices" element={<DeviceList />} />
          <Route path="/devices/connect" element={<ConnectDevice />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin/node-config" element={<NodeConfig />} />
          <Route path="/admin/users-groups" element={<UsersGroups />} />
          <Route path="/admin/settings" element={<SystemSettings />} />
          <Route path="/admin/variables" element={<Variables />} />
          <Route path="/admin/backup" element={<BackupRestore />} />
          <Route path="/admin/audit-logs" element={<AuditLogs />} />
          <Route path="/admin/ai" element={<AISettings />} />
          <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />

      {/* Force password change modal for users with default password */}
      {showPasswordModal && <ChangePasswordModal onPasswordChanged={handlePasswordChanged} />}
    </>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <QueryProvider>
        <UserProvider>
          <CurrencyProvider>
            <NotificationProvider>
              <AppNotificationProvider>
                <SidebarProvider>
                  <AppRoutes />
                </SidebarProvider>
              </AppNotificationProvider>
            </NotificationProvider>
          </CurrencyProvider>
        </UserProvider>
      </QueryProvider>
    </HashRouter>
  );
};

export default App;