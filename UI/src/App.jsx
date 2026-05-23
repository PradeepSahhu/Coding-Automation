import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [instructions, setInstructions] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

      if (instData.success) setInstructions(instData.instructions)
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

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#10b981'
      case 'failed': return '#ef4444'
      case 'in_progress': return '#f59e0b'
      case 'in_review': return '#8b5cf6'
      case 'pending': return '#3b82f6'
      default: return '#64748b'
    }
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
            <div key={item.id} className="card">
              <div className="card-header">
                <span className="issue-id">{item.issue_id}</span>
                <span 
                  className="status-badge" 
                  style={{ backgroundColor: getStatusColor(item.status) }}
                >
                  {item.status.replace('_', ' ')}
                </span>
              </div>
              <div className="card-body">
                <p className="instruction-text">
                  {item.instructions.split('\n')[0]}...
                </p>
                {item.pr_url && (
                  <a href={item.pr_url} target="_blank" rel="noopener noreferrer" className="pr-link">
                    <svg className="github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                    View Pull Request #{item.pr_number}
                  </a>
                )}
                {item.last_error && (
                  <div className="error-box">
                    <strong>Error:</strong> {item.last_error}
                  </div>
                )}
              </div>
              <div className="card-footer">
                <small>Created: {new Date(item.created_at).toLocaleString()}</small>
                {item.completed_at && (
                  <small>Completed: {new Date(item.completed_at).toLocaleString()}</small>
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
