# GEMINI.md

This file provides instructional context for the Coding Automation project, which integrates Jira and GitHub using an AI agent powered by Google Gemini and LangGraph.

## Project Overview

The **Coding Automation** project is an autonomous system designed to handle Jira issues by automatically generating code changes and opening Pull Requests on GitHub.

### Main Technologies
- **Runtime:** Node.js (ESM)
- **Framework:** Express.js
- **AI Orchestration:** LangChain / LangGraph
- **LLM:** DeepSeek (via `@langchain/openai`)
- **Database:** PostgreSQL (with `pg` driver and native NOTIFY/LISTEN for queueing)
- **External APIs:** Jira Webhooks, GitHub REST API (`@octokit/rest`)
- **Infrastructure:** Docker Compose (for DB), ngrok (for local webhook exposure)

### Architecture
For a detailed step-by-step walkthrough of how the system processes tasks, refer to [Design/system_workflow.md](Design/system_workflow.md).

1.  **Ingestion:** Jira webhooks notify the Backend when an issue is assigned to the configured Agent account.
2.  **Instruction Queue:** The Backend creates an entry in the `agent_instructions` table in PostgreSQL.
3.  **Worker:** A background `agentWorker` listens for Postgres notifications, claims pending instructions, and triggers the AI agent.
4.  **Execution:** The DeepSeek-powered agent uses tools to read the codebase, identify required changes, and submit a Pull Request.
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
- **Persistence:** All state transitions for an instruction (pending -> in_progress -> in_review -> completed/failed) are tracked in the DB.

### Agent Capabilities
- **Autonomous Coding:** Analyzes directory structure and implements logic based on instructions.
- **Jira Interaction:** Can fetch live updates (comments, description) and post comments back to Jira issues using the `get_jira_issue_details` and `post_jira_comment` tools.
- **GitHub PRs:** Handles branch creation, commits, and PR submission automatically.

### Folder & File Structure

Here is a comprehensive breakdown of the project layout and what each file is built to do:

#### Root Files
- [docker-compose.yml](file:///Users/pradeepsahu/Desktop/coding-automation/docker-compose.yml): Configures multi-container Docker services (the PostgreSQL DB `coding_automation_db` and the backend `coding_automation_backend`).
- [vercel.json](file:///Users/pradeepsahu/Desktop/coding-automation/vercel.json): Vercel Serverless configuration, routing all traffic to the backend serverless handler.
- [README.md](file:///Users/pradeepsahu/Desktop/coding-automation/README.md): High-level developer documentation, quick-start guide, and architectural summary.
- [GEMINI.md](file:///Users/pradeepsahu/Desktop/coding-automation/GEMINI.md): Instructions, conventions, environment variable setup, and file maps for Gemini AI agent runs.

#### Design Directory (`Design/`)
- [Design/complete_design_v1.excalidraw](file:///Users/pradeepsahu/Desktop/coding-automation/Design/complete_design_v1.excalidraw): Excalidraw visual diagram outlining the system architecture and state transitions.
- [Design/system_workflow.md](file:///Users/pradeepsahu/Desktop/coding-automation/Design/system_workflow.md): Deep-dive document detailing the step-by-step processing lifecycle of a task from Jira webhook to GitHub PR merge.

#### Backend Directory (`Backend/`)
- [Backend/server.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/server.js): Server entrypoint. Configures Express server routes, handles cors, registers webhooks, validates DeepSeek settings, and boots the agent worker.
- [Backend/Dockerfile](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Dockerfile): Configuration to containerize the backend API and worker.
- [Backend/Controllers/instructionController.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Controllers/instructionController.js): API controllers to query logs, instructions, and tasks for the UI dashboard.
- [Backend/Controllers/webhookController.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Controllers/webhookController.js): Route handlers to process Jira assignments/comments and GitHub reviews/status events.
- [Backend/Middleware/authMiddleware.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Middleware/authMiddleware.js): Custom middleware using HMAC verification to ensure incoming GitHub webhooks are secure and authentic.
- [Backend/Repository/instructionRepository.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Repository/instructionRepository.js): Database layer abstraction. Handles all SQL queries for claiming pending tasks, saving PR associations, updating error state, and writing dead letter entries.
- [Backend/db/init.sql](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/db/init.sql): Schema definition. Builds the tables, triggers, indexes, and pg_notify events required for queueing and logging.
- [Backend/Utility/Constants.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Utility/Constants.js): Holds constant configuration values for webhook event matching.
- [Backend/Utility/JiraUtility.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Utility/JiraUtility.js): Parsers to extract task text and comments out of the deeply nested Jira payloads.
- [Backend/Utility/Logger.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Utility/Logger.js): Unified logger class that writes logging outputs both to standard output and the database table.
- [Backend/Utility/WebhookUtility.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/Utility/WebhookUtility.js): Normalizes raw request bodies for GitHub signature checks and determines if issues are assigned to the agent account.

#### Backend Agent Logic (`Backend/agents/`)
- [Backend/agents/agentWorker.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/agents/agentWorker.js): Concurrency-controlled worker daemon. Establishes long-lived `LISTEN` sockets on PostgreSQL notifications and claims tasks. Transitions Jira issues to In Progress/Done based on state changes.
- [Backend/agents/deepseekLangGraphService.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/agents/deepseekLangGraphService.js): Prepares the LLM configuration (DeepSeek) and builds the LangGraph state machine agent. Generates system prompts and parses execution output to grab the created PR details.
- [Backend/agents/Tools/githubTools.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/agents/Tools/githubTools.js): Implements the `create_github_pull_request` tool using the Octokit client, handling branch refs, atomic git commits, and PR creation.
- [Backend/agents/Tools/jiraAgentTools.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/agents/Tools/jiraAgentTools.js): LangChain tools wrapper for Jira features (`get_jira_issue_details`, `post_jira_comment`).
- [Backend/agents/Tools/jiraTools.js](file:///Users/pradeepsahu/Desktop/coding-automation/Backend/agents/Tools/jiraTools.js): Underlying Jira HTTP integration to transition issues, create comments, and fetch details.

#### User Interface (`UI/`)
- [UI/index.html](file:///Users/pradeepsahu/Desktop/coding-automation/UI/index.html): Main HTML wrapper for the frontend web app.
- [UI/vite.config.js](file:///Users/pradeepsahu/Desktop/coding-automation/UI/vite.config.js): Configurations for building/developing with Vite.
- [UI/src/main.jsx](file:///Users/pradeepsahu/Desktop/coding-automation/UI/src/main.jsx): Bundler entry point that mounts the App component into the root element.
- [UI/src/App.jsx](file:///Users/pradeepsahu/Desktop/coding-automation/UI/src/App.jsx): Core UI component. Fetches data, displays logs and tasks list, renders status-colored labels, and provides links to live PRs.
- [UI/src/index.css](file:///Users/pradeepsahu/Desktop/coding-automation/UI/src/index.css): Resets and core visual setup.
- [UI/src/App.css](file:///Users/pradeepsahu/Desktop/coding-automation/UI/src/App.css): Modular dashboard styling layout.

### Environment Configuration
The following environment variables are required in `Backend/.env`:
- `DEEPSEEK_API_KEY`: For DeepSeek access.
- `DEEPSEEK_MODEL`: (Optional) Model name to use (default: deepseek-v4-flash).
- `GITHUB_TOKEN`: Personal Access Token for PR creation.
- `GITHUB_WEBHOOK_SECRET`: For validating incoming GitHub webhooks.
- `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`: For Jira API interactions.
- `JIRA_BASE_URL`: The full URL of your Jira instance (e.g., https://your-domain.atlassian.net).
- `JIRA_ASSIGNEE_ACCOUNT_ID`: The ID of the user the agent should listen for.
- `DATABASE_URL`: Connection string for PostgreSQL.
- `AGENT_POLLING_INTERVAL_MS`: (Optional) Database polling interval in milliseconds (default: 30000).
