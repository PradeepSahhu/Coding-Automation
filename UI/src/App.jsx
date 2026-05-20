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
      
      const instData = await instRes.json()
      const logData = await logRes.json()

      if (instData.success) setInstructions(instData.instructions)
      if (logData.success) setLogs(logData.logs)
      
    } catch (err) {
      setError('Failed to fetch data')
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
