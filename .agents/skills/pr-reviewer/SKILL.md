# UI Pull Request Review Skills & Guidelines

This document outlines the essential skills, criteria, and checklists required for reviewing Pull Requests (PRs) that modify the `UI/` (Frontend) directory of the Coding Automation project. All agents and developers must verify these criteria before merging a PR.

---

## 1. React Best Practices & Logic
- [ ] **State Management:** Ensure `useState` and `useEffect` are used correctly. Avoid derived state where possible (e.g., storing an ID rather than an entire object to prevent closure bugs).
- [ ] **Hook Dependencies:** Verify all `useEffect` and `useCallback` dependency arrays are complete and accurate to prevent infinite loops or stale closures.
- [ ] **Event Bubbling:** Check click handlers (especially on modals or cards). Use `e.stopPropagation()` where necessary to prevent unintended UI behaviors.
- [ ] **Error & Loading States:** Verify the UI gracefully handles asynchronous operations. There must be visual indicators for `loading` and `error` states when interacting with the backend API.
- [ ] **Component Structure:** Ensure large components are broken down logically. Reusable logic should be extracted into custom hooks or smaller functional components if the file grows too large.

## 2. UI / UX & Aesthetics
- [ ] **Theme Consistency:** All new styling must adhere to the existing dark mode theme in `App.css`. Do not introduce generic colors (e.g., plain red/blue); use harmonious, tailored hex codes.
- [ ] **Responsiveness:** Ensure CSS uses flexible layouts (`flexbox`, `grid`) and functions well across different screen sizes. Avoid hardcoded pixel widths that break mobile views.
- [ ] **Micro-animations:** Interactive elements (buttons, cards, links) should have subtle hover states and transitions (e.g., `transform: translateY()`, `box-shadow`) to feel alive and premium.
- [ ] **Typography & Legibility:** Verify that contrast ratios are sufficient for readability, particularly for terminal logs, error messages, and meta labels.

## 3. Build & Performance Validation
- [ ] **Production Build:** The code **must** compile successfully. The reviewer must verify that `npm run build` runs without Vite throwing syntax or resolution errors.
- [ ] **No Console Leaks:** Remove unnecessary `console.log` or debugging statements before merging, as they can clutter the browser console in production.
- [ ] **API Integrations:** Confirm that API calls use the `BACKEND_URL` correctly and handle CORS/network failures gracefully. 

## 4. Code Quality & Formatting
- [ ] **Clean Code:** Variables and functions must have descriptive, readable names.
- [ ] **Dead Code:** Ensure there are no orphaned tags, commented-out logic blocks, or unused imports remaining in the PR.
- [ ] **JSX Syntax:** Ensure all JSX tags are properly closed and scoped. (e.g., avoid orphaned `</section>` tags).

---

### Reviewer Workflow
If an AI agent is performing this review automatically upon PR creation:
1. Fetch the files modified in the PR.
2. Run `cd UI && npm run build` to confirm syntactic correctness.
3. Compare the modified logic against the checklists above.
4. If failures are detected, **Request Changes** on the PR with specific inline comments detailing the exact violation from this `SKILLS.md` file.
5. If all checks pass, **Approve** the PR.
