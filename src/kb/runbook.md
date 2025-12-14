# Checkout / Auth Runbook

## Symptoms
- "card authorization failed"
- sudden increase in 401/403
- checkout failures after security changes

## Common causes
- CSRF token mismatch due to cookie domain/path changes
- SameSite cookie changes breaking cross-site flows
- session rotation invalidating token
- caching layer serving stale CSRF token

## First checks
- verify CSRF cookie attributes (SameSite, Secure, Domain, Path)
- correlate failures by browser/version
- confirm rollout flags/canary behavior
- compare auth headers + cookies before/after deployment
