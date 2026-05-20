import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [instructions, setInstructions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchInstructions = async () => {
    try {
      const response = await fetch('/api/instructions')
      const data = await response.json()
      if (data.success) {
        setInstructions(data.instructions)
      } else {
        setError(data.message)
      }
    } catch (err) {
      setError('Failed to fetch instructions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInstructions()
    const interval = setInterval(fetchInstructions, 10000)
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
        <button onClick={fetchInstructions} className="refresh-btn">Refresh</button>
      </header>

      {loading && <p>Loading instructions...</p>}
      {error && <p className="error">Error: {error}</p>}

      {!loading && !error && (
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
      )}
    </div>
  )
}

export default App
