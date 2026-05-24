# PR Review Template

When executing a PR review, follow this template structure to provide clear, actionable feedback to the author.

---

## Review Summary
*(Provide a 2-3 sentence overview of the PR. Acknowledge what it attempts to solve, and give a high-level verdict.)*

## Actionable Feedback

*(Group feedback by severity or category. Use clear headings.)*

### 🚨 Critical / Blockers
*(Security flaws, infinite loops, syntax errors, or major architectural regressions that MUST be fixed.)*
- **[File/Line]:** Description of the issue.
    - *Suggested Fix:* (Include code snippet if possible).

### ⚠️ Needs Adjustment
*(Styling inconsistencies, poor variable naming, missing dependency arrays in hooks, or minor bugs.)*
- **[File/Line]:** Description of the issue.
    - *Suggested Fix:* (Include code snippet if possible).

### 💡 Suggestions / Nitpicks
*(Non-blocking suggestions for better performance, cleaner code, or stylistic improvements. The author can merge without fixing these.)*
- **[File/Line]:** Description of the suggestion.

## Verification Checklist
- [ ] Code compiles without syntax errors.
- [ ] UI changes match the dark mode theme.
- [ ] No hardcoded API keys or secrets.
- [ ] No leftover `console.log` statements (unless specifically for the agent execution logs).

## Final Verdict
*(State clearly: **Approved**, **Request Changes**, or **Comment**)*
