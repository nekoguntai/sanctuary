import React, { useState, useEffect } from 'react';
import {
  FileText,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  User,
  Shield,
  Wallet,
  Cpu,
  Settings,
  Database,
  Clock,
  Search,
  X,
} from 'lucide-react';
import {
  getAuditLogs,
  getAuditLogStats,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogStats,
} from '../src/api/admin';
import { createLogger } from '../utils/logger';

const log = createLogger('AuditLogs');

// Category icon mapping
const categoryIcons: Record<string, React.ReactNode> = {
  auth: <Shield className="w-4 h-4" />,
  user: <User className="w-4 h-4" />,
  wallet: <Wallet className="w-4 h-4" />,
  device: <Cpu className="w-4 h-4" />,
  admin: <Settings className="w-4 h-4" />,
  backup: <Database className="w-4 h-4" />,
  system: <Settings className="w-4 h-4" />,
  gateway: <Shield className="w-4 h-4" />, // Mobile API gateway events
};

// Category color classes
const categoryColors: Record<string, string> = {
  auth: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  user: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  wallet: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  device: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  backup: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  system: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  gateway: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
};

// Format action name for display
function formatAction(action: string): string {
  return action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' - ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const pageSize = 25;

  // Filter state
  const [filters, setFilters] = useState<AuditLogQuery>({});
  const [filterUsername, setFilterUsername] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterSuccess, setFilterSuccess] = useState<string>('');

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const query: AuditLogQuery = {
        ...filters,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      };
      const result = await getAuditLogs(query);
      setLogs(result.logs);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const result = await getAuditLogStats(30);
      setStats(result);
    } catch (err) {
      log.error('Failed to load audit stats', { error: err });
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [currentPage, filters]);

  const applyFilters = () => {
    const newFilters: AuditLogQuery = {};
    if (filterUsername) newFilters.username = filterUsername;
    if (filterCategory) newFilters.category = filterCategory;
    if (filterAction) newFilters.action = filterAction;
    if (filterSuccess !== '') newFilters.success = filterSuccess === 'true';
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilterUsername('');
    setFilterCategory('');
    setFilterAction('');
    setFilterSuccess('');
    setFilters({});
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);
  const hasActiveFilters = Object.keys(filters).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            Audit Logs
          </h1>
          <p className="text-sanctuary-500 dark:text-sanctuary-400 mt-1">
            Security and activity logs for the system
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center px-3 py-2 text-sm rounded-lg border transition-colors ${
              showFilters || hasActiveFilters
                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                : 'border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
            }`}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
            {hasActiveFilters && (
              <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-primary-500 text-white">
                {Object.keys(filters).length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              fetchLogs();
              fetchStats();
            }}
            disabled={loading}
            className="flex items-center px-3 py-2 text-sm rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="surface-elevated rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
                Total Events (30d)
              </span>
              <FileText className="w-5 h-5 text-sanctuary-400" />
            </div>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-2">
              {stats.totalEvents.toLocaleString()}
            </p>
          </div>
          <div className="surface-elevated rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
                Failed Events
              </span>
              <AlertTriangle className="w-5 h-5 text-warning-500" />
            </div>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-2">
              {stats.failedEvents.toLocaleString()}
            </p>
          </div>
          <div className="surface-elevated rounded-xl p-4 col-span-2">
            <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
              Events by Category
            </span>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(stats.byCategory).map(([cat, count]) => (
                <span
                  key={cat}
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    categoryColors[cat] || categoryColors.system
                  }`}
                >
                  {categoryIcons[cat]}
                  <span className="ml-1">{cat}</span>
                  <span className="ml-1 opacity-75">({count})</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div className="surface-elevated rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Username
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
                <input
                  type="text"
                  value={filterUsername}
                  onChange={(e) => setFilterUsername(e.target.value)}
                  placeholder="Filter by username..."
                  className="w-full pl-10 pr-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Category
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
              >
                <option value="">All categories</option>
                <option value="auth">Authentication</option>
                <option value="user">User Management</option>
                <option value="wallet">Wallet</option>
                <option value="device">Device</option>
                <option value="admin">Admin</option>
                <option value="backup">Backup</option>
                <option value="system">System</option>
                <option value="gateway">Gateway (Mobile API)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Action
              </label>
              <input
                type="text"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                placeholder="Filter by action..."
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
                Status
              </label>
              <select
                value={filterSuccess}
                onChange={(e) => setFilterSuccess(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
              >
                <option value="">All</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={clearFilters}
              className="px-4 py-2 text-sm rounded-lg text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
            >
              Clear
            </button>
            <button
              onClick={applyFilters}
              className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Logs Table */}
      <div className="surface-elevated rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="surface-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sanctuary-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading audit logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sanctuary-500">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center text-sm">
                        <Clock className="w-4 h-4 text-sanctuary-400 mr-2" />
                        <span
                          className="text-sanctuary-900 dark:text-sanctuary-100"
                          title={new Date(log.createdAt).toLocaleString()}
                        >
                          {formatRelativeTime(log.createdAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                        {log.username}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          categoryColors[log.category] || categoryColors.system
                        }`}
                      >
                        {categoryIcons[log.category]}
                        <span className="ml-1">{log.category}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                        {formatAction(log.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.success ? (
                        <span className="inline-flex items-center text-success-600 dark:text-success-400">
                          <CheckCircle className="w-4 h-4 mr-1" />
                          <span className="text-sm">Success</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-red-600 dark:text-red-400">
                          <XCircle className="w-4 h-4 mr-1" />
                          <span className="text-sm">Failed</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400 font-mono">
                        {log.ipAddress || '-'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, total)} of {total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedLog(null)}
          />
          <div className="relative bg-white dark:bg-sanctuary-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 flex items-center justify-between p-4 border-b border-sanctuary-200 dark:border-sanctuary-800 bg-white dark:bg-sanctuary-900">
              <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                Audit Log Details
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Timestamp
                  </label>
                  <p className="text-sanctuary-900 dark:text-sanctuary-100">
                    {new Date(selectedLog.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    User
                  </label>
                  <p className="text-sanctuary-900 dark:text-sanctuary-100">
                    {selectedLog.username}
                    {selectedLog.userId && (
                      <span className="text-sanctuary-500 text-sm ml-2">
                        ({selectedLog.userId.slice(0, 8)}...)
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Category
                  </label>
                  <p>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        categoryColors[selectedLog.category] || categoryColors.system
                      }`}
                    >
                      {categoryIcons[selectedLog.category]}
                      <span className="ml-1">{selectedLog.category}</span>
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Action
                  </label>
                  <p className="text-sanctuary-900 dark:text-sanctuary-100">
                    {formatAction(selectedLog.action)}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Status
                  </label>
                  <p>
                    {selectedLog.success ? (
                      <span className="inline-flex items-center text-success-600 dark:text-success-400">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-red-600 dark:text-red-400">
                        <XCircle className="w-4 h-4 mr-1" />
                        Failed
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    IP Address
                  </label>
                  <p className="text-sanctuary-900 dark:text-sanctuary-100 font-mono">
                    {selectedLog.ipAddress || '-'}
                  </p>
                </div>
              </div>

              {selectedLog.errorMsg && (
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Error Message
                  </label>
                  <p className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg mt-1">
                    {selectedLog.errorMsg}
                  </p>
                </div>
              )}

              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    Details
                  </label>
                  <pre className="mt-1 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 text-sm text-sanctuary-700 dark:text-sanctuary-300 overflow-x-auto">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.userAgent && (
                <div>
                  <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                    User Agent
                  </label>
                  <p className="text-sanctuary-600 dark:text-sanctuary-400 text-sm break-all">
                    {selectedLog.userAgent}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
