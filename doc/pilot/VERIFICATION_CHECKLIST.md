# Pilot Verification Checklist

This is the pre-pilot verification gate for the current candidate build. It is meant to be runnable in under 30 minutes on staging by one operator plus one product/test owner.

Related:
- [route-map.md](../route-map.md)
- [OBSERVABILITY_RUNBOOK.md](../OBSERVABILITY_RUNBOOK.md)
- [OPERATIONS_RUNBOOK.md](../OPERATIONS_RUNBOOK.md)

## Timebox

Target time: 25 to 30 minutes total.

Suggested evidence to capture:
- deployed commit SHA or workflow URL
- timestamp of the pass
- name of operator/tester
- pass/fail notes for any blocked step

## 1. Runtime Health

Expected time: 3 minutes

- [ ] Open web `GET /healthz` and confirm `200`
- [ ] Open web `GET /version` and confirm a non-empty version
- [ ] Open worker `GET /healthz` and confirm `200`
- [ ] Confirm the current Azure alert baseline is present:
  - worker health check failures
  - unhandled runtime errors
  - participant notification delivery failures if external delivery is enabled

## 2. Entra Auth Redirect

Expected time: 4 minutes

- [ ] Start from a signed-out browser/session
- [ ] Open one canonical protected route from the route map, for example `/participant` or `/admin-content`
- [ ] Confirm redirect to Entra happens cleanly
- [ ] Complete sign-in and confirm return to the intended route
- [ ] Confirm no obvious redirect loop or callback error occurs

## 3. Admin Content Library Actions

Expected time: 6 minutes

Canonical routes from [route-map.md](../route-map.md):
- `/admin-content`
- `/admin-content/module/:moduleId/conversation`
- `/admin-content/module/:moduleId/advanced`

- [ ] Open `/admin-content`
- [ ] Confirm module library loads
- [ ] Open an existing module into conversation mode
- [ ] Switch to advanced mode
- [ ] Switch back to conversation mode
- [ ] From the library, confirm one basic list action is usable without error:
  - open module
  - duplicate module
  - archive/restore path if suitable test data exists

## 4. Course Flow

Expected time: 4 minutes

Canonical routes from [route-map.md](../route-map.md):
- `/admin-content/courses`
- `/admin-content/courses/new`
- `/admin-content/courses/:courseId`

- [ ] Open `/admin-content/courses`
- [ ] Confirm course list loads
- [ ] Open an existing course or create a throwaway draft course
- [ ] Confirm module assignment / ordering UI loads without error
- [ ] If a publish action is in scope for the candidate, confirm publish dialog/path is reachable

## 5. Module Route Transitions

Expected time: 4 minutes

- [ ] Open one module in conversation mode
- [ ] Make a small unsaved change
- [ ] Switch to advanced mode and confirm module context is preserved
- [ ] Return to conversation mode and confirm the module context still matches
- [ ] Confirm no blank-state regression appears during mode transitions

## 6. Review And Appeal Sanity

Expected time: 5 minutes

Canonical routes from [route-map.md](../route-map.md):
- `/review`
- `/participant/completed`

- [ ] Open `/review` and confirm the queue/workspace loads
- [ ] Open `/participant/completed` for a test user with history, if available
- [ ] Confirm completed-result view loads
- [ ] Confirm the appeal entry path is visible when suitable test data exists
- [ ] Confirm no obvious authorization leak or empty-page failure occurs on either route

## 7. Release Gate Decision

- [ ] Pass if all sections above complete without blocking defects
- [ ] Fail if any of these occur:
  - Entra sign-in does not return to the intended route
  - Admin Content library or module route transitions break module context
  - course workspace fails to load or basic module assignment is broken
  - review/completed-result sanity path is unavailable
  - web or worker health endpoint is unhealthy
  - required pilot alerts are missing

## Recording

When the pass is complete:

- [ ] record outcome in the deployment note, issue, or incident log
- [ ] link any failures to follow-up GitHub issues
- [ ] if the pass is clean, mark the build as a pilot candidate rather than relying only on local test results
