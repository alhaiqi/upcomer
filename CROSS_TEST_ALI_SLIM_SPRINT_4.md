# Ali Slim - Sprint 4 assigned cross-testing

Scope from the updated plan: independently test Ali Shammakh's US-34, US-35, US-37, US-39, and US-45. This is automated evidence prepared with AI assistance for Ali Slim to review and enter in Jira; it is not a claim that Ali Slim personally signed off or that his own work was independently accepted.

## Available implementation: advice

Tests use real application services and an isolated, migrated PostgreSQL database with their own course/student fixtures. The existing `tests/integration/advice.test.ts` exercises 13 integrated cases. Unit/rule suites (`tests/unit/advice.test.ts`, `tests/unit/advice-rules.test.ts`) add 45 cases, including failure paths and link parsing.

| Story | Positive checks | Negative and boundary checks | Result |
| --- | --- | --- | --- |
| US-34 | Course, exam, session, topic and question scopes save readable labels in the right course | Foreign/missing scopes, pending papers and unknown topics rejected; deleting a target retains a safe scope snapshot | Passed automated checks |
| US-35 | HTTPS resource and title save correctly | JavaScript/data/plain HTTP schemes and credential-bearing URLs rejected; no row saved on invalid links | Passed automated checks |
| US-37 | Anonymous public feed/search/filter payloads show Anonymous student; author storage remains available for moderation | No name in anonymous payloads, no raw author ID in any public result; anonymous owner's isMine remains correct; named posts retain intentional attribution | Passed automated checks |
| US-39 | Case-insensitive text plus topic/exam/session filtering; combined filters; paging | Cross-course results excluded, foreign exam/session filters empty, literal percent/underscore handled, removed posts excluded | Passed automated checks |

Two pre-existing test defects were reproduced and corrected before the retest:

1. Rate-limit windows leaked across integration cases, so later legitimate fixture publications failed with `rate_limited`. Each case now resets the in-memory rate store; the product limit is unchanged and unit tests still test rate limiting.
2. An anonymity assertion rejected an intentional named post by the same author elsewhere in a mixed feed. The name-leak assertion now inspects anonymous payloads; the raw-ID assertion still inspects the whole payload. The anonymous item and owner/admin storage assertions remain.

Retest: all 13 advice integration cases pass in the full 129-test second-pass integration run. All advice unit/rule cases also pass in the unit suite. Missing existing advice log event declarations on main were added so TypeScript and production build work.

This does not accept the entire E3 release: moderation, ratings, discussions and anonymity across those not-yet-delivered surfaces need their owners' integration tests. The plan's public-release moderation gate remains applicable.

## US-45: configurable mock exam

The current branch has no US-45 mock configuration/session/sitting implementation, so no end-to-end independent acceptance is claimed. Ali Slim delivered its upstream US-44 contract:

- Exact generation count/topic/difficulty, stable item IDs, private course-scoped libraries and source provenance.
- `getGeneratedPracticeQuestions` excludes deleted/replaced/private/retagged/corrected sources and other students' libraries.
- `rubric` is nullable and unknown grading evidence must be flagged.

Once US-45 is merged, Ali Slim should independently check chosen topic/length/difficulty against stored item IDs, insufficient eligible items, invalid inputs, cross-course/student access, persistence after refresh, and a usable sitting/submission flow. Actual US-49 grading should then deliver outcomes through the stable mock evidence adapter without duplicates. Record valid/invalid cases, defects, corrections and retests in Jira.

## Release/sign-off boundary

No Jira updates, teammate messages, remote approvals, merges or deployed demo were performed. Ali Slim's review and independent member acceptance remain required. All local database fixtures created by the automated tests are cleaned up; shared database credentials were not used.
