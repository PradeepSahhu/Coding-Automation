# Example: Security-Focused PR Review

This example highlights security vulnerabilities that must be caught during a PR review.

## Summary
The implementation for the GitHub Webhook verification works, but it introduces a critical security vulnerability by exposing the secret token.

## Critical Security Feedback

**1. Hardcoded Secrets (Critical)**
In `webhookController.js`, the GitHub webhook secret is hardcoded directly into the file:
```javascript
const GITHUB_SECRET = "my_super_secret_token_123";
```
**Action Required:** Remove this immediately. Secrets must never be hardcoded or checked into version control. You must use environment variables:
```javascript
const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
```

**2. Missing HMAC Verification (Critical)**
The webhook endpoint is accepting payloads without verifying the `x-hub-signature-256` header. This allows anyone on the internet to send forged webhook events to our backend, potentially triggering unauthorized agent runs.
**Action Required:** Implement `crypto.createHmac` verification against the raw request body before processing the payload.

## Conclusion
This PR cannot be merged in its current state due to severe security risks. Please implement environment variable handling and HMAC signature validation, then request another review.
