import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [instructions, setInstructions] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Details View and Execution Logs state
  const [selectedInstructionId, setSelectedInstructionId] = useState(null)
  const [instructionLogs, setInstructionLogs] = useState([])
  const [loadingInstructionLogs, setLoadingInstructionLogs] = useState(false)

  const selectedInstruction = instructions.find(i => i.id === selectedInstructionId) || null

  const BACKEND_URL = 'https://coding-automation.vercel.app';

  const fetchData = async () => {
    try {
      const [instRes, logRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/instructions`),
        fetch(`${BACKEND_URL}/api/logs`)
      ])
      
      if (!instRes.ok) {
        throw new Error(`Backend returned ${instRes.status} for instructions`)
      }
      if (!logRes.ok) {
        throw new Error(`Backend returned ${logRes.status} for logs`)
      }

      const instData = await instRes.json()
      const logData = await logRes.json()

      if (instData.success) {
        setInstructions(instData.instructions)
      }
      if (logData.success) setLogs(logData.logs)
      
    } catch (err) {
      console.error('Fetch error:', err)
      setError(`Failed to fetch data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  // Fetch execution logs for specific instruction
  useEffect(() => {
    if (!selectedInstruction) {
      setInstructionLogs([])
      return
    }

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/instructions/${selectedInstruction.id}/logs`)
        if (!res.ok) {
          throw new Error('Failed to fetch instruction logs')
        }
        const data = await res.json()
        if (data.success) {
          setInstructionLogs(data.logs)
        }
      } catch (err) {
        console.error('Error fetching logs:', err)
      }
    }

    fetchLogs()
    let interval
    if (selectedInstruction.status === 'in_progress') {
      interval = setInterval(fetchLogs, 2500)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedInstruction])

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#10b981'
      case 'failed': return '#ef4444'
      case 'failed_pr': return '#f43f5e'
      case 'in_progress': return '#f59e0b'
      case 'in_review': return '#8b5cf6'
      case 'pending': return '#3b82f6'
      default: return '#64748b'
    }
  }

  const getDurationText = (item) => {
    if (!item.started_at) return null
    const start = new Date(item.started_at)
    const end = item.ended_at ? new Date(item.ended_at) : new Date()
    const diffMs = end - start
    if (diffMs < 0) return '0s'

    const diffSecs = Math.floor(diffMs / 1000)
    const minutes = Math.floor(diffSecs / 60)
    const seconds = diffSecs % 60

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  if (selectedInstruction) {
    return (
      <div className="container">
        <header>
          <h1>Task Overview</h1>
          <button onClick={() => setSelectedInstructionId(null)} className="refresh-btn">Back to Dashboard</button>
        </header>
        
        <div className="details-view">
          <div className="modal-meta-grid">
            <div className="modal-meta-card">
              <span className="meta-label">Jira Story</span>
              <span className="meta-val highlight-val">{selectedInstruction.issue_id}</span>
            </div>
            <div className="modal-meta-card">
              <span className="meta-label">Status</span>
              <span className="status-badge" style={{ backgroundColor: getStatusColor(selectedInstruction.status) }}>
                {selectedInstruction.status === 'failed_pr' ? 'PR Failed' : selectedInstruction.status.replace('_', ' ')}
              </span>
            </div>
            {getDurationText(selectedInstruction) && (
              <div className="modal-meta-card">
                <span className="meta-label">Time Taken</span>
                <span className="meta-val duration-val">{getDurationText(selectedInstruction)}</span>
              </div>
            )}
          </div>

          <div className="modal-section">
            <h3>Story Instructions</h3>
            <div className="instructions-container">
              <pre>{selectedInstruction.instructions}</pre>
            </div>
          </div>

          {selectedInstruction.pr_url && (
            <div className="modal-section pr-modal-section">
              <h3>Generated Pull Request</h3>
              <a href={selectedInstruction.pr_url} target="_blank" rel="noopener noreferrer" className="pr-link">
                <svg className="github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                View Pull Request #{selectedInstruction.pr_number}
              </a>
            </div>
          )}

          {selectedInstruction.last_error && (
            <div className="modal-section error-modal-section">
              <h3>Failure Diagnostics</h3>
              <div className="error-box">
                <strong>Error:</strong> {selectedInstruction.last_error}
              </div>
            </div>
          )}

          <div className="modal-section">
            <h3>Agent Execution logs</h3>
            <div className="terminal-logs">
              {instructionLogs.length === 0 ? (
                <p className="log-empty">
                  {selectedInstruction.status === 'pending'
                    ? 'Task is pending in queue. Agent has not started executing.'
                    : 'No logs recorded for this task.'}
                </p>
              ) : (
                instructionLogs.map((log, idx) => (
                  <div key={idx} className="terminal-line">
                    <span className="terminal-time">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                    <span className="terminal-text">{log.log_line}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header>
        <h1>Coding Automation Dashboard</h1>
        <button onClick={fetchData} className="refresh-btn">Refresh</button>
      </header>

      {loading && instructions.length === 0 && <p>Loading...</p>}
      {error && <p className="error">Error: {error}</p>}

      <section>
        <h2>Instructions</h2>
        {!loading && instructions.length === 0 && <p>No instructions found.</p>}
        <div className="grid">
          {instructions.map((item) => (
            <div key={item.id} className="card clickable-card" onClick={() => setSelectedInstructionId(item.id)}>
              <div className="card-header">
                <span className="issue-id">{item.issue_id}</span>
                <span 
                  className="status-badge" 
                  style={{ backgroundColor: getStatusColor(item.status) }}
                >
                  {item.status === 'failed_pr' ? 'PR Failed' : item.status.replace('_', ' ')}
                </span>
              </div>
              <div className="card-body">
                <p className="instruction-text">
                  {item.instructions.split('\n')[0]}...
                </p>
                {item.pr_url && (
                  <a 
                    href={item.pr_url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="pr-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    View PR #{item.pr_number}
                  </a>
                )}
                {item.last_error && (
                  <div className="error-box">
                    <strong>Error:</strong> {item.last_error.substring(0, 80)}...
                  </div>
                )}
              </div>
              <div className="card-footer">
                <small>Created: {new Date(item.created_at).toLocaleString()}</small>
                {getDurationText(item) && (
                  <small className="duration-tag">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline-block' }}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Time taken: {getDurationText(item)}
                  </small>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="logs-section">
        <h2>Backend Logs</h2>
        <div className="logs-container">
          {logs.length === 0 && <p>No logs available.</p>}
          {logs.map((log) => (
            <div key={log.id} className={`log-entry ${log.level}`}>
              <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className="log-level">{log.level.toUpperCase()}</span>
              <span className="log-msg">{log.message}</span>
              {log.context && <pre className="log-ctx">{JSON.stringify(log.context)}</pre>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default App
