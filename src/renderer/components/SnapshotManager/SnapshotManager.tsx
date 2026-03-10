import React, { useState, useEffect } from 'react';
import { useConnection } from '../../hooks/useConnection';
import { useSnapshots } from '../../hooks/useSnapshots';
import { useToast } from '../../hooks/useToast';
import { useDemoMode } from '../../hooks/useDemoMode';
import { SnapshotDiffModal } from './SnapshotDiffModal';
import type { ConfigurationSnapshot } from '@shared/types/common.types';
import type { SnapshotRestoreProgress } from '@shared/types/ipc.types';
import './SnapshotManager.css';

const PAGE_SIZE = 20;
let persistedSnapshotsPage = 1;

// Exported for testing — reset module-level state between tests
export function _resetPersistedSnapshotsPage() {
  persistedSnapshotsPage = 1;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function SnapshotManager() {
  const { status } = useConnection();
  const {
    snapshots,
    loading,
    error,
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    loadSnapshot,
  } = useSnapshots();
  const { isDemoMode } = useDemoMode();
  const toast = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [_selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [restoreBackup, setRestoreBackup] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<SnapshotRestoreProgress | null>(null);
  const [diffSnapshots, setDiffSnapshots] = useState<{
    before: ConfigurationSnapshot;
    after: ConfigurationSnapshot;
  } | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [snapshotsPage, setSnapshotsPage] = useState(persistedSnapshotsPage);

  // Keep module-level var in sync for persistence across unmounts
  useEffect(() => {
    persistedSnapshotsPage = snapshotsPage;
  }, [snapshotsPage]);

  // Reset page if current page exceeds available pages (only when data is loaded)
  const totalSnapshotsPages = Math.max(1, Math.ceil(snapshots.length / PAGE_SIZE));
  useEffect(() => {
    if (snapshots.length > 0 && snapshotsPage > totalSnapshotsPages) {
      setSnapshotsPage(totalSnapshotsPages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots.length, totalSnapshotsPages]);

  const snapshotsPageStart = (snapshotsPage - 1) * PAGE_SIZE;
  const pageSnapshots = snapshots.slice(snapshotsPageStart, snapshotsPageStart + PAGE_SIZE);

  useEffect(() => {
    if (!restoring) return;
    const unsubscribe = window.betaflight.onRestoreProgress((progress) => {
      setRestoreProgress(progress);
    });
    return unsubscribe;
  }, [restoring]);

  const handleCreateSnapshot = async () => {
    const result = await createSnapshot(snapshotLabel || undefined);
    if (result) {
      setShowCreateDialog(false);
      setSnapshotLabel('');
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    if (confirm('Are you sure you want to delete this snapshot?')) {
      await deleteSnapshot(id);
    }
  };

  const handleViewSnapshot = async (id: string) => {
    const snapshot = await loadSnapshot(id);
    if (snapshot) {
      setSelectedSnapshot(id);
      // Show snapshot details (could open a modal)
      const blob = new Blob([snapshot.configuration.cliDiff], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot-${snapshot.label}-${new Date(snapshot.timestamp).toISOString().split('T')[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Snapshot exported');
    }
  };

  const handleRestoreClick = (id: string) => {
    setRestoreConfirmId(id);
    setRestoreBackup(true);
  };

  const handleRestoreConfirm = async () => {
    if (!restoreConfirmId) return;
    setRestoring(true);
    setRestoreProgress(null);
    const id = restoreConfirmId;
    setRestoreConfirmId(null);
    try {
      await restoreSnapshot(id, restoreBackup);
    } finally {
      setRestoring(false);
      setRestoreProgress(null);
    }
  };

  const handleRestoreCancel = () => {
    setRestoreConfirmId(null);
  };

  const handleCompare = async (snapshotId: string, index: number) => {
    setLoadingDiff(true);
    try {
      const afterSnapshot = await loadSnapshot(snapshotId);
      if (!afterSnapshot) return;

      const afterNum = snapshots.length - index;
      const afterWithNum = { ...afterSnapshot, label: `#${afterNum} ${afterSnapshot.label}` };
      const afterMeta = snapshots[index];

      // Smart compare: match pre-tuning ↔ post-tuning by session number
      if (afterMeta.snapshotRole && afterMeta.tuningSessionNumber) {
        const targetRole = afterMeta.snapshotRole === 'post-tuning' ? 'pre-tuning' : 'post-tuning';
        // For pre-tuning, look for the previous session's post-tuning
        const targetSessionNum =
          afterMeta.snapshotRole === 'pre-tuning'
            ? afterMeta.tuningSessionNumber - 1
            : afterMeta.tuningSessionNumber;

        if (targetSessionNum > 0) {
          const matchIdx = snapshots.findIndex(
            (s) => s.snapshotRole === targetRole && s.tuningSessionNumber === targetSessionNum
          );
          if (matchIdx >= 0) {
            const beforeSnapshot = await loadSnapshot(snapshots[matchIdx].id);
            if (beforeSnapshot) {
              const beforeNum = snapshots.length - matchIdx;
              const beforeWithNum = {
                ...beforeSnapshot,
                label: `#${beforeNum} ${beforeSnapshot.label}`,
              };
              setDiffSnapshots({ before: beforeWithNum, after: afterWithNum });
              return;
            }
          }
        }

        // Pre-tuning #1 with no previous post-tuning — compare with baseline
        if (afterMeta.snapshotRole === 'pre-tuning' && targetSessionNum === 0) {
          const baselineIdx = snapshots.findIndex((s) => s.type === 'baseline');
          if (baselineIdx >= 0) {
            const beforeSnapshot = await loadSnapshot(snapshots[baselineIdx].id);
            if (beforeSnapshot) {
              const beforeNum = snapshots.length - baselineIdx;
              const beforeWithNum = {
                ...beforeSnapshot,
                label: `#${beforeNum} ${beforeSnapshot.label}`,
              };
              setDiffSnapshots({ before: beforeWithNum, after: afterWithNum });
              return;
            }
          }
        }
      }

      // Fallback: chronological compare (for old snapshots without metadata)
      if (index >= snapshots.length - 1) {
        // Oldest snapshot — compare with empty config
        const emptyBefore: ConfigurationSnapshot = {
          ...afterSnapshot,
          id: 'empty',
          label: '(empty)',
          configuration: { cliDiff: '' },
        };
        setDiffSnapshots({ before: emptyBefore, after: afterWithNum });
      } else {
        const beforeSnapshot = await loadSnapshot(snapshots[index + 1].id);
        if (!beforeSnapshot) return;
        const beforeNum = snapshots.length - (index + 1);
        const beforeWithNum = { ...beforeSnapshot, label: `#${beforeNum} ${beforeSnapshot.label}` };
        setDiffSnapshots({ before: beforeWithNum, after: afterWithNum });
      }
    } finally {
      setLoadingDiff(false);
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">Configuration Snapshots</h2>

      {error && <div className="error">{error}</div>}

      <div className="snapshot-actions">
        <button
          className="primary"
          onClick={() => setShowCreateDialog(true)}
          disabled={!status.connected || loading}
        >
          Create Snapshot
        </button>
      </div>

      {showCreateDialog && (
        <div className="create-dialog">
          <h3>Create Snapshot</h3>
          <input
            type="text"
            placeholder="Name (optional)"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
          />
          <div className="dialog-actions">
            <button className="primary" onClick={handleCreateSnapshot} disabled={loading}>
              Create
            </button>
            <button className="secondary" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {restoreConfirmId && (
        <div className="create-dialog">
          <h3>Restore Snapshot</h3>
          <p className="restore-warning">
            This will restore FC configuration from this snapshot. FC will reboot.
          </p>
          <label className="restore-checkbox">
            <input
              type="checkbox"
              checked={restoreBackup}
              onChange={(e) => setRestoreBackup(e.target.checked)}
            />
            Create backup before restoring
          </label>
          <div className="dialog-actions">
            <button className="primary" onClick={handleRestoreConfirm}>
              Restore
            </button>
            <button className="secondary" onClick={handleRestoreCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {restoring && restoreProgress && (
        <div className="restore-progress">
          <div className="restore-progress-text">{restoreProgress.message}</div>
          <div className="restore-progress-bar">
            <div
              className="restore-progress-fill"
              style={{ width: `${restoreProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="snapshot-list">
        {loading && <div>Loading snapshots...</div>}

        {snapshots.length === 0 && !loading && (
          <div className="no-snapshots">
            No snapshots yet. Create one to save your configuration.
          </div>
        )}

        {pageSnapshots.map((snapshot, index) => {
          const globalIndex = snapshotsPageStart + index;
          return (
            <div key={snapshot.id} className="snapshot-item">
              <div className="snapshot-info">
                <div className="snapshot-label">
                  <span className="snapshot-number">#{snapshots.length - globalIndex}</span>
                  {snapshot.label}
                  {snapshot.type === 'baseline' && <span className="badge baseline">Baseline</span>}
                  {snapshot.snapshotRole === 'pre-tuning' && (
                    <span className="badge pre-tuning">Pre-tuning</span>
                  )}
                  {snapshot.snapshotRole === 'post-tuning' && (
                    <span className="badge post-tuning">Post-tuning</span>
                  )}
                </div>
                <div className="snapshot-meta">
                  <span>{new Date(snapshot.timestamp).toLocaleString()}</span>
                  <span>•</span>
                  <span>
                    {snapshot.fcInfo.variant} {snapshot.fcInfo.version}
                  </span>
                  <span>•</span>
                  <span>{formatBytes(snapshot.sizeBytes)}</span>
                </div>
              </div>
              <div className="snapshot-actions-item">
                <button
                  className="secondary"
                  onClick={() => handleCompare(snapshot.id, globalIndex)}
                  disabled={loadingDiff}
                >
                  Compare
                </button>
                <button
                  className="secondary"
                  onClick={() => handleRestoreClick(snapshot.id)}
                  disabled={!status.connected || loading || restoring || isDemoMode}
                  title={isDemoMode ? 'Not available in demo mode' : undefined}
                >
                  {restoring ? 'Restoring...' : 'Restore'}
                </button>
                <button className="secondary" onClick={() => handleViewSnapshot(snapshot.id)}>
                  Export
                </button>
                {snapshot.type !== 'baseline' && (
                  <button className="danger" onClick={() => handleDeleteSnapshot(snapshot.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalSnapshotsPages > 1 && (
        <div className="pagination-controls">
          <button
            className="pagination-button"
            onClick={() => setSnapshotsPage((p) => p - 1)}
            disabled={snapshotsPage <= 1}
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {snapshotsPage} of {totalSnapshotsPages}
          </span>
          <button
            className="pagination-button"
            onClick={() => setSnapshotsPage((p) => p + 1)}
            disabled={snapshotsPage >= totalSnapshotsPages}
          >
            Next
          </button>
        </div>
      )}

      {diffSnapshots && (
        <SnapshotDiffModal
          snapshotA={diffSnapshots.before}
          snapshotB={diffSnapshots.after}
          onClose={() => setDiffSnapshots(null)}
        />
      )}
    </div>
  );
}
