import React, { useEffect, useState, useRef } from 'react';
import { useConnection } from '../../hooks/useConnection';
import './ConnectionPanel.css';

export function ConnectionPanel() {
  const { ports, status, loading, error, scanPorts, connect, disconnect } = useConnection();
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [reconnectCooldown, setReconnectCooldown] = useState(0);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    scanPorts();
  }, [scanPorts]);

  useEffect(() => {
    // If no port selected, select first available
    if (ports.length > 0 && !selectedPort) {
      setSelectedPort(ports[0].path);
      return;
    }

    // If selected port no longer exists in the list, select first available
    if (ports.length > 0 && selectedPort) {
      const portExists = ports.some((port) => port.path === selectedPort);
      if (!portExists) {
        setSelectedPort(ports[0].path);
      }
    }

    // If no ports available, clear selection
    if (ports.length === 0 && selectedPort) {
      setSelectedPort('');
    }
  }, [ports, selectedPort]);

  // Auto-set cooldown on any disconnect (FC reboot, USB unplug, etc.)
  useEffect(() => {
    if (wasConnectedRef.current && !status.connected) {
      setReconnectCooldown(3);
      // Rescan ports after disconnect to detect FC when it comes back
      setTimeout(() => {
        scanPorts();
      }, 1500);
    }
    wasConnectedRef.current = status.connected;
  }, [status.connected, scanPorts]);

  useEffect(() => {
    if (reconnectCooldown > 0) {
      const timer = setTimeout(() => {
        setReconnectCooldown(reconnectCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [reconnectCooldown]);

  const handleConnect = async () => {
    if (selectedPort) {
      await connect(selectedPort);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    // Cooldown and port rescan are handled by the auto-disconnect effect
  };

  return (
    <div className="panel">
      <h2 className="panel-title">Connection</h2>

      {error && <div className="error">{error}</div>}
      {reconnectCooldown > 0 && (
        <div
          className="info"
          style={{
            padding: '8px 12px',
            backgroundColor: '#1e3a5f',
            border: '1px solid #2563eb',
            borderRadius: '4px',
            marginBottom: '12px',
            fontSize: '13px',
            color: '#93c5fd',
          }}
        >
          Wait {reconnectCooldown} second{reconnectCooldown !== 1 ? 's' : ''} before reconnecting...
        </div>
      )}

      <div className="connection-controls">
        {!status.connected && (
          <div className="port-selection">
            <label htmlFor="port-select">Serial Port:</label>
            <select
              id="port-select"
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={loading || reconnectCooldown > 0}
            >
              {ports.length === 0 && <option value="">No ports found</option>}
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.path}
                  {port.manufacturer && ` - ${port.manufacturer}`}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              onClick={scanPorts}
              disabled={loading || reconnectCooldown > 0}
            >
              {loading ? 'Scanning...' : 'Scan'}
            </button>
          </div>
        )}

        <div className="connection-status">
          <span className="status-label">Status: </span>
          {status.connected ? (
            <span className="status-connected">
              ● Connected <span className="connection-port-info">{selectedPort}</span>
            </span>
          ) : (
            <span className="status-disconnected">Disconnected</span>
          )}
        </div>

        <div className="connection-actions">
          {status.connected ? (
            <button className="danger" onClick={handleDisconnect} disabled={loading}>
              {loading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="primary"
              onClick={handleConnect}
              disabled={!selectedPort || loading || ports.length === 0 || reconnectCooldown > 0}
            >
              {loading
                ? 'Connecting...'
                : reconnectCooldown > 0
                  ? `Wait ${reconnectCooldown}s`
                  : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
