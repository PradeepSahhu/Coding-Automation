# Coding Automation Agent 🚀

An autonomous AI agent system that integrates Jira and GitHub to automate software engineering tasks. This system listens for Jira assignments, generates code changes using Google Gemini, submits Pull Requests, and handles feedback loops automatically.

## 🌟 Key Features
- **Autonomous Coding:** Uses Gemini and LangGraph to analyze codebases and implement features/fixes.
- **Jira Integration:** Automatically picks up assigned issues and transitions them to "In Progress" or "Done".
- **GitHub Automation:** Creates branches, commits code, and opens Pull Requests.
- **Real-time Dashboard:** A React-based UI to monitor task status (Pending, In Progress, Completed, Failed).
- **Feedback Loop:** Automatically handles PR review comments or manual triggers via `[agent-fix]` comments.
- **Reliable Queueing:** PostgreSQL-backed task queue with `LISTEN/NOTIFY` and polling fallbacks.

## 🏗️ Architecture
The system follows a modular MVC-like pattern:
- **Backend:** Node.js/Express with modular controllers and middlewares.
- **Agent:** LangGraph-orchestrated worker using Google Gemini LLM.
- **UI:** Vite-powered React dashboard for observability.
- **Database:** PostgreSQL for persistent task management.

For a deep dive into the technical workflow, see [Design/system_workflow.md](Design/system_workflow.md).

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+) & Docker
- Google Gemini API Key
- GitHub Personal Access Token
- Jira API Token

### 2. Infrastructure
Start the database using Docker Compose:
```bash
docker-compose up -d
```

### 3. Backend Setup
```bash
cd Backend
npm install
npm run dev
```

### 4. UI Setup
```bash
cd UI
npm install
npm run dev
```

### 5. Webhook Exposure (Local Dev)
Use ngrok to expose your local server (port 3000) to receive webhooks:
```bash
ngrok http 3000
```
Register the ngrok URL in your [Jira Webhooks](https://officialpradeepsahu.atlassian.net/plugins/servlet/webhooks) and GitHub repository settings.

## 📖 Documentation
- [GEMINI.md](GEMINI.md) - Detailed setup, environment variables, and development guidelines.
- [Design/system_workflow.md](Design/system_workflow.md) - Technical walkthrough of the agent's lifecycle.

## 🛠️ Commands
- **Check DB Status:**
  ```bash
  docker exec -i coding_automation_db psql -U agentuser -d agentdb -c "SELECT * FROM agent_instructions ORDER BY id;"
  ```
- **Deploy to Vercel:** `vercel` (Requires environment variable configuration).

---
*Built with ❤️ using Gemini, LangGraph, and Node.js.*
