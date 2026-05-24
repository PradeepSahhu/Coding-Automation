# Coding Standards

This document outlines the coding standards for the Coding Automation project.

## General
- **Language:** JavaScript (ES6+). Avoid var; use const and let.
- **Module System:** ES Modules (`import`/`export`) must be used exclusively in both Frontend and Backend.
- **Formatting:** Use 2 spaces for indentation.
- **Clean Code:** Variables and functions must have descriptive names (`fetchData` instead of `fd`).

## Frontend (React/Vite)
- **Functional Components:** Use functional components and hooks exclusively. No class components.
- **State:** Prefer deriving state from props or higher-level state rather than duplicating data (e.g., store `selectedId` rather than a full `selectedObject`).
- **Styling:** Use Vanilla CSS in `App.css`. Avoid inline styles unless absolutely necessary for dynamic layout logic. Adhere to the established dark mode hex codes.
- **Responsiveness:** Build mobile-first or ensure flex/grid layouts fluidly adapt to smaller screens.

## Backend (Express/Node.js)
- **Error Handling:** Always use `try/catch` blocks for asynchronous operations. Never let an unhandled promise rejection crash the server.
- **Logging:** Use the custom `Logger.js` (`logger.info`, `logger.error`) instead of raw `console.log` for production endpoints. Agent logic should use `console.log` only because it is intercepted via `AsyncLocalStorage`.
- **Database:** Always parameterize PostgreSQL queries (`$1, $2`) using `pg` to prevent SQL injection.
