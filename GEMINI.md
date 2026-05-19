# GEMINI.md

This file provides instructional context for the Coding Automation project, which integrates Jira and GitHub using an AI agent powered by Google Gemini and LangGraph.

## Project Overview

The **Coding Automation** project is an autonomous system designed to handle Jira issues by automatically generating code changes and opening Pull Requests on GitHub.

### Main Technologies
- **Runtime:** Node.js (ESM)
- **Framework:** Express.js
- **AI Orchestration:** LangChain / LangGraph
- **LLM:** Google Gemini (via `@langchain/google-genai`)
- **Database:** PostgreSQL (with `pg` driver and native NOTIFY/LISTEN for queueing)
- **External APIs:** Jira Webhooks, GitHub REST API (`@octokit/rest`)
- **Infrastructure:** Docker Compose (for DB), ngrok (for local webhook exposure)

### Architecture
1.  **Ingestion:** Jira webhooks notify the Backend when an issue is assigned to the configured Agent account.
2.  **Instruction Queue:** The Backend creates an entry in the `agent_instructions` table in PostgreSQL.
3.  **Worker:** A background `agentWorker` listens for Postgres notifications, claims pending instructions, and triggers the AI agent.
4.  **Execution:** The Gemini-powered agent uses tools to read the codebase, identify required changes, and submit a Pull Request.
5.  **Feedback Loop:** GitHub webhooks (PR merged, closed, or review feedback) trigger status updates in Jira and can create follow-up instructions for the agent (e.g., to fix PR review comments).

---

## Building and Running

### Prerequisites
- Docker and Docker Compose
- Node.js (v18+)
- ngrok (for receiving webhooks locally)
- Environment variables (see `.env` requirements below)

### Setup Commands
1.  **Start Database:**
    ```bash
    docker-compose up -d
    ```
2.  **Install Dependencies:**
    ```bash
    cd Backend
    npm install
    ```
3.  **Run Backend (Development):**
    ```bash
    cd Backend
    npm run dev
    ```
4.  **Run UI (Development):**
    ```bash
    cd UI
    npm install
    npm run dev
    ```
5.  **Expose for Webhooks:**
    ```bash
    ngrok http 3000
    ```

### Vercel Deployment
The project is configured for Vercel deployment using the `vercel.json` file.
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the root directory.
3. Configure all required environment variables in the Vercel dashboard.

**Important Note:** Vercel Serverless Functions have execution time limits. The `agentWorker` (which handles long-running AI tasks and polling) is better suited for a persistent environment like a VPS, AWS EC2, or a dedicated container. On Vercel, the worker will only trigger during active webhook requests and may be terminated before completing complex tasks.

### Database Operations
The agent worker uses both PostgreSQL `LISTEN/NOTIFY` and a 30-second polling interval to check for pending instructions.

To check the current instructions and their status:
```bash
docker exec -i coding_automation_db psql -U agentuser -d agentdb -c "SELECT * FROM agent_instructions ORDER BY id;"
```

---

## Development Conventions

### Coding Style
- **Modules:** The project uses ES Modules (`import/export`).
- **Validation:** Uses `zod` for schema validation and type safety.
- **Error Handling:** Failed instructions are moved to a `dead_letter_queue` after several retries.
- **Persistence:** All state transitions for an instruction (pending -> in_progress -> completed/failed) are tracked in the DB.

### Key Directories
- `Backend/server.js`: Main entry point and webhook handlers.
- `Backend/agents/`: Core logic for the AI worker and LangGraph service.
- `Backend/agents/Tools/`: Custom tools available to the Gemini agent (GitHub/Jira interaction).
- `Backend/Repository/`: Database abstraction layer for instruction management.
- `Backend/Utility/`: Constants and helper functions for external API integrations.
- `Backend/db/`: Database initialization scripts and schema definitions.

### Environment Configuration
The following environment variables are required in `Backend/.env`:
- `GOOGLE_API_KEY`: For Gemini access.
- `GITHUB_TOKEN`: Personal Access Token for PR creation.
- `GITHUB_WEBHOOK_SECRET`: For validating incoming GitHub webhooks.
- `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`: For Jira API interactions.
- `JIRA_ASSIGNEE_ACCOUNT_ID`: The ID of the user the agent should listen for.
- `DATABASE_URL`: Connection string for PostgreSQL.
- `AGENT_POLLING_INTERVAL_MS`: (Optional) Database polling interval in milliseconds (default: 30000).
