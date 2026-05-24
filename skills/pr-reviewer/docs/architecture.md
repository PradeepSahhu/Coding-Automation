# Architecture Overview

This document provides a high-level overview of the Coding Automation project to assist PR reviewers in understanding the system boundaries.

## System Architecture

The project is split into two primary domains:

### 1. Backend (`/Backend`)
- **Runtime:** Node.js Express server (`server.js`).
- **Database:** PostgreSQL. Interacted with via standard `pg` driver (`Repository/instructionRepository.js`). Uses `LISTEN/NOTIFY` channels for task queueing.
- **Workers:** An asynchronous daemon (`agents/agentWorker.js`) polls the database and listens for notifications, spawning LangGraph/Gemini agents to perform tasks.
- **Tools:** Agents utilize tools located in `agents/Tools/` to hit the Jira API and GitHub API.

### 2. Frontend (`/UI`)
- **Framework:** React 18 with Vite.
- **Structure:** Single Page Application (SPA).
- **Core Files:** 
  - `App.jsx`: Contains the primary dashboard logic, fetching instructions and logs from the backend via REST APIs.
  - `App.css`: Contains the CSS design system (Vanilla CSS, no Tailwind).
- **State Flow:** The dashboard fetches data via HTTP polling (e.g., `setInterval(fetchData, 60000)`). No WebSockets are currently used.

## Review Guidelines
When reviewing PRs, verify that changes respect these boundaries. 
- UI code must not contain direct database queries or raw API keys.
- Backend tools must return properly parsed JSON or strings, not complex nested DOM elements.
