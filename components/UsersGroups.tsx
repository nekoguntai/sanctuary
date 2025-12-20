import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { Users, UserPlus, Shield, User as UserIcon, Plus, Trash2, Edit2, X, Eye, EyeOff, Info } from 'lucide-react';
import * as adminApi from '../src/api/admin';
import { AdminUser, AdminGroup } from '../src/api/admin';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { createLogger } from '../utils/logger';

const log = createLogger('UsersGroups');

export const UsersGroups: React.FC = () => {
  const { handleError } = useErrorHandler();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Create User Modal State
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editUserError, setEditUserError] = useState<string | null>(null);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  // Create Group State
  const [newGroup, setNewGroup] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Edit Group Modal State
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [isUpdatingGroup, setIsUpdatingGroup] = useState(false);

  const loadData = async () => {
    try {
      const [usersData, groupsData] = await Promise.all([
        adminApi.getUsers(),
        adminApi.getGroups()
      ]);
      setUsers(usersData);
      setGroups(groupsData);
    } catch (error) {
      log.error('Failed to load data', { error });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      setCreateUserError('Username and password are required');
      return;
    }

    setIsCreatingUser(true);
    setCreateUserError(null);

    try {
      await adminApi.createUser({
        username: newUsername.trim(),
        password: newPassword,
        email: newEmail.trim() || undefined,
        isAdmin: newIsAdmin
      });

      // Reset form and close modal
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');
      setNewIsAdmin(false);
      setShowCreateUser(false);

      // Reload users
      loadData();
    } catch (error: any) {
      log.error('Create user error', { error });
      setCreateUserError(error.message || 'Failed to create user');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditEmail(user.email || '');
    setEditIsAdmin(user.isAdmin);
    setEditPassword('');
    setEditUserError(null);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    setIsUpdatingUser(true);
    setEditUserError(null);

    try {
      const updateData: adminApi.UpdateUserRequest = {};

      if (editUsername !== editingUser.username) {
        updateData.username = editUsername;
      }
      if (editEmail !== (editingUser.email || '')) {
        updateData.email = editEmail || undefined;
      }
      if (editIsAdmin !== editingUser.isAdmin) {
        updateData.isAdmin = editIsAdmin;
      }
      if (editPassword) {
        updateData.password = editPassword;
      }

      await adminApi.updateUser(editingUser.id, updateData);

      setEditingUser(null);
      loadData();
    } catch (error: any) {
      log.error('Update user error', { error });
      setEditUserError(error.message || 'Failed to update user');
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteUser(user.id);
      loadData();
    } catch (error) {
      log.error('Delete user error', { error });
      handleError(error, 'Delete User Failed');
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroup.trim()) return;

    setIsCreatingGroup(true);

    try {
      await adminApi.createGroup({ name: newGroup.trim() });
      setNewGroup('');
      loadData();
    } catch (error) {
      log.error('Create group error', { error });
      handleError(error, 'Create Group Failed');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleDeleteGroup = async (group: AdminGroup) => {
    if (!confirm(`Are you sure you want to delete group "${group.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await adminApi.deleteGroup(group.id);
      loadData();
    } catch (error) {
      log.error('Delete group error', { error });
      handleError(error, 'Delete Group Failed');
    }
  };

  const handleEditGroup = (group: AdminGroup) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditGroupMembers(group.members.map(m => m.userId));
    setEditGroupError(null);
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup) return;

    setIsUpdatingGroup(true);
    setEditGroupError(null);

    try {
      await adminApi.updateGroup(editingGroup.id, {
        name: editGroupName,
        memberIds: editGroupMembers,
      });

      setEditingGroup(null);
      loadData();
    } catch (error: any) {
      log.error('Update group error', { error });
      setEditGroupError(error.message || 'Failed to update group');
    } finally {
      setIsUpdatingGroup(false);
    }
  };

  const toggleGroupMember = (userId: string) => {
    setEditGroupMembers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading users and groups...</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Users & Groups</h2>
        <p className="text-sanctuary-500">Manage system users and groups</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* User Management */}
        <div className="space-y-6">
           <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
                <Users className="w-5 h-5" />
                <h3 className="text-lg font-medium">Users</h3>
              </div>
              <Button size="sm" onClick={() => setShowCreateUser(true)}>
                <UserPlus className="w-4 h-4 mr-2" /> Add User
              </Button>
           </div>

           <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
              <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
                 {users.length === 0 ? (
                   <li className="p-8 text-center text-sanctuary-400">No users found</li>
                 ) : users.map(u => (
                   <li key={u.id} className="p-4 flex items-center justify-between hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                      <div className="flex items-center space-x-3">
                         <div className={`p-2 rounded-full ${u.isAdmin ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400'}`}>
                            {u.isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                         </div>
                         <div>
                            <p className="font-medium text-sm">{u.username}</p>
                            <p className="text-xs text-sanctuary-400">{u.email || 'No email'}</p>
                         </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {u.isAdmin && (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 px-2 py-1 rounded">
                            Admin
                          </span>
                        )}
                        <button
                          onClick={() => handleEditUser(u)}
                          className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                   </li>
                 ))}
              </ul>
           </div>
        </div>

        {/* Group Management */}
         <div className="space-y-6">
           <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
              <Users className="w-5 h-5" />
              <h3 className="text-lg font-medium">Groups</h3>
           </div>

           <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
              <div className="p-4 surface-secondary border-b border-sanctuary-100 dark:border-sanctuary-800">
                 <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newGroup}
                      onChange={(e) => setNewGroup(e.target.value)}
                      placeholder="New group name"
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                    />
                    <Button size="sm" onClick={handleCreateGroup} disabled={!newGroup || isCreatingGroup} isLoading={isCreatingGroup}>
                       <Plus className="w-4 h-4 mr-2" /> Create
                    </Button>
                 </div>
                 <div className="flex items-center gap-2 mt-3 text-xs text-sanctuary-500 dark:text-sanctuary-400">
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>You are not automatically added to groups you create. Add yourself as a member to see wallets shared with the group.</span>
                 </div>
              </div>
              <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
                 {groups.length === 0 ? (
                   <li className="p-8 text-center text-sanctuary-400">No groups found</li>
                 ) : groups.map(g => (
                   <li key={g.id} className="p-4 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                         <h4 className="font-medium text-sm">{g.name}</h4>
                         <div className="flex items-center space-x-2">
                           <span className="text-xs surface-secondary px-2 py-0.5 rounded text-sanctuary-600 dark:text-sanctuary-400">
                              {g.members.length} Members
                           </span>
                           <button
                             onClick={() => handleEditGroup(g)}
                             className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                             title="Edit group"
                           >
                             <Edit2 className="w-3.5 h-3.5" />
                           </button>
                           <button
                             onClick={() => handleDeleteGroup(g)}
                             className="p-1 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                             title="Delete group"
                           >
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                         </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                         {g.members.length === 0 ? (
                           <span className="text-[10px] text-sanctuary-400 italic">No members</span>
                         ) : g.members.map(member => (
                           <span key={member.userId} className="text-[10px] px-1.5 py-0.5 border border-sanctuary-200 dark:border-sanctuary-700 rounded text-sanctuary-500">
                             {member.username} {member.role === 'admin' && '(admin)'}
                           </span>
                         ))}
                      </div>
                   </li>
                 ))}
              </ul>
           </div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowCreateUser(false)}>
          <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Create New User</h3>
              <button onClick={() => setShowCreateUser(false)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {createUserError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {createUserError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username *</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter password (min 6 characters)"
                    className="w-full px-3 py-2 pr-10 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setNewIsAdmin(!newIsAdmin)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${newIsAdmin ? 'bg-amber-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${newIsAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setShowCreateUser(false)}>Cancel</Button>
              <Button onClick={handleCreateUser} isLoading={isCreatingUser} disabled={!newUsername || !newPassword}>
                Create User
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditingUser(null)}>
          <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit User: {editingUser.username}</h3>
              <button onClick={() => setEditingUser(null)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editUserError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {editUserError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password (leave blank to keep current)</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full px-3 py-2 pr-10 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setEditIsAdmin(!editIsAdmin)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${editIsAdmin ? 'bg-amber-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editIsAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setEditingUser(null)}>Cancel</Button>
              <Button onClick={handleUpdateUser} isLoading={isUpdatingUser}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditingGroup(null)}>
          <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit Group</h3>
              <button onClick={() => setEditingGroup(null)} className="text-sanctuary-400 hover:text-sanctuary-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editGroupError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
                {editGroupError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Group Name</label>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Members</label>
                <div className="max-h-48 overflow-y-auto border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
                  {users.length === 0 ? (
                    <p className="p-3 text-sm text-sanctuary-400 text-center">No users available</p>
                  ) : (
                    users.map(user => (
                      <label
                        key={user.id}
                        className="flex items-center p-3 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer border-b border-sanctuary-100 dark:border-sanctuary-800 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={editGroupMembers.includes(user.id)}
                          onChange={() => toggleGroupMember(user.id)}
                          className="w-4 h-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">{user.username}</span>
                        {user.isAdmin && (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(admin)</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-sanctuary-400">
                  {editGroupMembers.length} member{editGroupMembers.length !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button variant="secondary" onClick={() => setEditingGroup(null)}>Cancel</Button>
              <Button onClick={handleUpdateGroup} isLoading={isUpdatingGroup} disabled={!editGroupName.trim()}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
