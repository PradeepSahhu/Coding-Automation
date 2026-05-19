# System Workflow & Architecture

This document details the step-by-step process of how the Coding Automation system handles autonomous software engineering tasks.

## 1. Task Ingestion (Jira Webhook)
- **Trigger:** A Jira issue is created or updated and assigned to the configured Agent account.
- **Handler:** The Backend receives a POST request at `/jira-webhook`.
- **Validation:** The system checks if the assignee matches `JIRA_ASSIGNEE_ACCOUNT_ID`.
- **Persistence:** 
  - If no pending task exists for the issue, it creates a new entry in `agent_instructions`.
  - If a **pending** task already exists, it updates the instructions with the latest details, ensuring the agent always has the most recent context.
- **Notification:** PostgreSQL triggers a `pg_notify` on the `agent_instruction_created` channel.

## 2. Worker Orchestration
- **Listener:** The `agentWorker` process is constantly listening for Postgres notifications and also polls the DB every 30 seconds as a fallback.
- **Concurrency:** When a task is detected, a worker "claims" the row by updating its status to `in_progress` (using `SKIP LOCKED` for thread safety).
- **Retry Logic:** If an agent fails, the worker retries the task up to 3 times with exponential backoff before moving it to the `dead_letter_queue`.

## 3. Autonomous Agent Execution (LangGraph + Gemini)
- **Context Gathering:** 
  - The agent reads the project files and the snapshot instructions from the database.
  - **Hybrid Logic:** If the agent finds the instructions ambiguous or suspects recent changes, it can use the `get_jira_issue_details` tool to fetch live data (description, comments, status) directly from the Jira API.
- **Decision Making:** Using the Gemini LLM, the agent decides which files need modification.
- **Execution:**
  - The agent applies code changes locally.
  - It uses the `githubTools` to create a new branch.
  - It commits the changes and pushes the branch to GitHub.
  - Finally, it opens a Pull Request (PR) and saves the PR URL back to the database.

## 4. Feedback & Iteration (GitHub Webhook)
- **PR Reviews:** If a human reviewer requests changes on GitHub, the `/github-webhook` receives a `pull_request_review` event.
- **Follow-up:** The system automatically creates a new "follow-up" instruction linked to the same PR, which the agent picks up to apply fixes.
- **Triggered Fixes:** Users can also trigger the agent manually by commenting `[agent-fix]` on any PR.

## 5. Completion & Synchronization
- **Merge Event:** When the PR is merged, the GitHub webhook notifies the backend.
- **Jira Update:** The system automatically transitions the corresponding Jira issue to `Done`.
- **Status Update:** The instruction in the database is marked as `completed` with a timestamp.

## 6. Monitoring (React Dashboard)
- **Data Fetch:** The React UI polls the `/api/instructions` endpoint every 10 seconds.
- **Visualization:** Users can monitor the real-time status (Pending, In Progress, Completed, Failed) and click direct links to the generated GitHub Pull Requests.

---

## Technical Component Map
| Component | Responsibility |
| :--- | :--- |
| **Express Server** | Routing, Webhook verification, API endpoints. |
| **PostgreSQL** | Source of truth, task queueing, notification bus. |
| **agentWorker** | Background job management, concurrency, Jira transitions. |
| **LangGraph Agent** | Brain of the system; autonomous coding and tool use. |
| **React Dashboard** | Observability and status tracking. |
