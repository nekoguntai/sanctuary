import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, HashRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { WalletList } from './components/WalletList';
import { WalletDetail } from './components/WalletDetail';
import { SendTransaction } from './components/SendTransaction';
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
import { BackupRestore } from './components/BackupRestore';
import { AuditLogs } from './components/AuditLogs';
import { CurrencyProvider } from './contexts/CurrencyContext';
import { UserProvider, useUser } from './contexts/UserContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { AppNotificationProvider } from './contexts/AppNotificationContext';
import { SidebarProvider } from './contexts/SidebarContext';
import { NotificationContainer } from './components/NotificationToast';
import { useNotifications } from './contexts/NotificationContext';
import { QueryProvider } from './providers/QueryProvider';

const AppRoutes: React.FC = () => {
  const { isAuthenticated, logout, user, updatePreferences } = useUser();
  const { notifications, removeNotification } = useNotifications();

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
          <Route path="/wallets/:id/send" element={<SendTransaction />} />
          <Route path="/devices" element={<DeviceList />} />
          <Route path="/devices/connect" element={<ConnectDevice />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin/node-config" element={<NodeConfig />} />
          <Route path="/admin/users-groups" element={<UsersGroups />} />
          <Route path="/admin/settings" element={<SystemSettings />} />
          <Route path="/admin/backup" element={<BackupRestore />} />
          <Route path="/admin/audit-logs" element={<AuditLogs />} />
          <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <NotificationContainer notifications={notifications} onDismiss={removeNotification} />
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