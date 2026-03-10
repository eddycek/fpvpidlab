import { useState } from 'react';
import { ProfileCard } from './ProfileCard';
import { ProfileEditModal } from './ProfileEditModal';
import { ProfileDeleteModal } from './ProfileDeleteModal';
import { useProfiles } from '../hooks/useProfiles';
import { useConnection } from '../hooks/useConnection';
import type { DroneProfile } from '@shared/types/profile.types';
import './ProfileSelector.css';

export function ProfileSelector() {
  const {
    profiles,
    currentProfile,
    loading,
    error,
    setAsCurrentProfile,
    updateProfile,
    deleteProfile,
    getProfile,
    exportProfile: _exportProfile,
  } = useProfiles();

  const { status: connectionStatus } = useConnection();

  const [expanded, setExpanded] = useState(false);
  const [editingProfile, setEditingProfile] = useState<DroneProfile | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<DroneProfile | null>(null);

  const handleSelect = async (id: string) => {
    if (currentProfile?.id === id) {
      // If clicking current profile, just collapse
      setExpanded(false);
    } else {
      // Prevent profile switching when FC is connected
      if (connectionStatus.connected) {
        console.log('Cannot switch profiles while FC is connected');
        return;
      }

      try {
        await setAsCurrentProfile(id);
        setExpanded(false);
      } catch (err) {
        console.error('Failed to switch profile:', err);
      }
    }
  };

  const handleEdit = async (id: string) => {
    try {
      const profile = await getProfile(id);
      if (profile) {
        setEditingProfile(profile);
      }
    } catch (err) {
      console.error('Failed to load profile for editing:', err);
    }
  };

  const handleEditSave = async (input: any) => {
    if (!editingProfile) return;
    try {
      await updateProfile(editingProfile.id, input);
      setEditingProfile(null);
    } catch (err) {
      console.error('Failed to update profile:', err);
      throw err;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const profile = await getProfile(id);
      if (profile) {
        setDeletingProfile(profile);
      }
    } catch (err) {
      console.error('Failed to load profile for deletion:', err);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProfile) return;
    try {
      await deleteProfile(deletingProfile.id);
      setDeletingProfile(null);
      setExpanded(false); // Close the dropdown after deletion
    } catch (err) {
      console.error('Failed to delete profile:', err);
      throw err;
    }
  };

  const handleExport = async (id: string) => {
    // In Electron, we would use dialog to get save path
    // For now, just log
    console.log('Export profile:', id);
    // TODO: Implement export with file dialog
    alert('Export functionality will be implemented with file dialog');
  };

  if (!currentProfile && profiles.length === 0) {
    return null; // Don't show if no profiles exist yet
  }

  return (
    <div className="profile-selector">
      <div className="profile-selector-container">
        {/* Current Profile Header */}
        <div onClick={() => setExpanded(!expanded)} className="profile-selector-header">
          <div className="profile-selector-current">
            <div className="profile-selector-label">Current Drone Profile</div>
            {currentProfile ? (
              <>
                <div className="profile-selector-name">{currentProfile.name}</div>
                <div className="profile-selector-details">
                  {currentProfile.size} • {currentProfile.battery}
                </div>
              </>
            ) : (
              <div className="profile-selector-name" style={{ color: '#666666' }}>
                No profile selected
              </div>
            )}
          </div>

          <div className="profile-selector-meta">
            <div className="profile-selector-count">
              {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}
            </div>
            <svg
              className={`profile-selector-icon ${expanded ? 'expanded' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        {/* Profile List */}
        {expanded && (
          <div className="profile-selector-list">
            {loading && <div className="profile-selector-loading">Loading profiles...</div>}

            {error && <div className="profile-selector-error">{error}</div>}

            {!loading && !error && profiles.length === 0 && (
              <div className="profile-selector-empty">
                No profiles yet. Connect a flight controller to create one.
              </div>
            )}

            {!loading && !error && profiles.length > 0 && (
              <>
                {connectionStatus.connected && (
                  <div className="profile-selector-lock-notice">
                    <svg
                      width="14"
                      height="14"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      style={{ flexShrink: 0 }}
                    >
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Profile locked while FC is connected</span>
                  </div>
                )}
                {profiles.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    isActive={currentProfile?.id === profile.id}
                    isLocked={connectionStatus.connected && currentProfile?.id !== profile.id}
                    onSelect={handleSelect}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onExport={handleExport}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingProfile && (
        <ProfileEditModal
          profile={editingProfile}
          onSave={handleEditSave}
          onCancel={() => setEditingProfile(null)}
        />
      )}

      {/* Delete Modal */}
      {deletingProfile && (
        <ProfileDeleteModal
          profile={deletingProfile}
          isActive={currentProfile?.id === deletingProfile.id}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingProfile(null)}
        />
      )}
    </div>
  );
}
