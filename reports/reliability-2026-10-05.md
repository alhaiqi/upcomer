# Reliability Report — 2026-10-05

- **Date:** 2026-10-05T00:52:11.118Z
- **Commit:** `703c054`
- **Seed:** `1781972973` (repeat with `RELIABILITY_SEED=1781972973 RELIABILITY_RUNS=50 npm run reliability`)
- **Trials per feature:** 50
- **Overall success rate:** **99.8%** (549 of 550 trials; 1 failure)
- **Duration:** 216 s
- **Database restored:** yes — every table's row count and the upload folders match the start of the run

A trial is a success when the system does the right thing: it accepts valid input, or it correctly refuses invalid input. It is a failure when the system errors, refuses valid input, or accepts invalid input. Average response time is the main request of each trial, measured by the client.

## Summary

| Feature | Trials | Successes | Failures | Success rate | Avg response |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sign up | 50 | 50 | 0 | 100.0% | 66.0 ms |
| Log in | 50 | 50 | 0 | 100.0% | 159.6 ms |
| Log out | 50 | 50 | 0 | 100.0% | 52.3 ms |
| Add to My Courses | 50 | 50 | 0 | 100.0% | 185.5 ms |
| Search courses | 50 | 49 | 1 | 98.0% | 249.0 ms |
| Course page | 50 | 50 | 0 | 100.0% | 191.5 ms |
| Exam and material lists | 50 | 50 | 0 | 100.0% | 286.6 ms |
| Open file | 50 | 50 | 0 | 100.0% | 69.7 ms |
| Admin upload | 50 | 50 | 0 | 100.0% | 211.6 ms |
| Catalog save | 50 | 50 | 0 | 100.0% | 230.7 ms |
| File metadata save | 50 | 50 | 0 | 100.0% | 235.2 ms |
| **Overall** | 550 | 549 | 1 | **99.8%** | 176.2 ms |

## By feature and trial type

### Sign up

50 trials, 50 successes, 0 failures, 100.0%, average 66.0 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| missing name | invalid | 16 | 16 | 0 | 100.0% | 7.2 ms |
| bad email | invalid | 7 | 7 | 0 | 100.0% | 6.9 ms |
| valid new account | valid | 11 | 11 | 0 | 100.0% | 151.2 ms |
| short password | invalid | 6 | 6 | 0 | 100.0% | 7.8 ms |
| duplicate email | invalid | 10 | 10 | 0 | 100.0% | 142.5 ms |

### Log in

50 trials, 50 successes, 0 failures, 100.0%, average 159.6 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| wrong password | invalid | 13 | 13 | 0 | 100.0% | 138.0 ms |
| correct password | valid | 17 | 17 | 0 | 100.0% | 209.7 ms |
| unknown email | invalid | 20 | 20 | 0 | 100.0% | 131.0 ms |

### Log out

50 trials, 50 successes, 0 failures, 100.0%, average 52.3 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| logged-in student | valid | 15 | 15 | 0 | 100.0% | 98.2 ms |
| no session | valid | 21 | 21 | 0 | 100.0% | 5.3 ms |
| forged session cookie | invalid | 14 | 14 | 0 | 100.0% | 73.7 ms |

### Add to My Courses

50 trials, 50 successes, 0 failures, 100.0%, average 185.5 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| unknown course | invalid | 14 | 14 | 0 | 100.0% | 216.3 ms |
| duplicate | invalid | 10 | 10 | 0 | 100.0% | 256.7 ms |
| not logged in | invalid | 12 | 12 | 0 | 100.0% | 7.5 ms |
| new course | valid | 14 | 14 | 0 | 100.0% | 256.3 ms |

### Search courses

50 trials, 49 successes, 1 failures, 98.0%, average 249.0 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| special characters | valid | 4 | 3 | 1 | 75.0% | 167.8 ms |
| unknown filter | invalid | 6 | 6 | 0 | 100.0% | 117.7 ms |
| name fragment | valid | 5 | 5 | 0 | 100.0% | 294.0 ms |
| combined filters | valid | 7 | 7 | 0 | 100.0% | 302.4 ms |
| code fragment | valid | 3 | 3 | 0 | 100.0% | 338.4 ms |
| everything | valid | 4 | 4 | 0 | 100.0% | 262.6 ms |
| faculty filter | valid | 3 | 3 | 0 | 100.0% | 337.8 ms |
| spaced code | valid | 8 | 8 | 0 | 100.0% | 284.8 ms |
| professor filter | valid | 7 | 7 | 0 | 100.0% | 271.0 ms |
| no match | valid | 3 | 3 | 0 | 100.0% | 77.4 ms |

### Course page

50 trials, 50 successes, 0 failures, 100.0%, average 191.5 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| existing course | valid | 32 | 32 | 0 | 100.0% | 255.6 ms |
| unknown course | invalid | 18 | 18 | 0 | 100.0% | 77.5 ms |

### Exam and material lists

50 trials, 50 successes, 0 failures, 100.0%, average 286.6 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| materials of an existing course | valid | 17 | 17 | 0 | 100.0% | 394.5 ms |
| exams of an existing course | valid | 16 | 16 | 0 | 100.0% | 393.2 ms |
| unknown course | invalid | 17 | 17 | 0 | 100.0% | 78.4 ms |

### Open file

50 trials, 50 successes, 0 failures, 100.0%, average 69.7 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| valid file | valid | 12 | 12 | 0 | 100.0% | 75.1 ms |
| unknown id | invalid | 18 | 18 | 0 | 100.0% | 67.9 ms |
| missing file | invalid | 11 | 11 | 0 | 100.0% | 68.7 ms |
| path traversal | invalid | 9 | 9 | 0 | 100.0% | 67.4 ms |

### Admin upload

50 trials, 50 successes, 0 failures, 100.0%, average 211.6 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| corrupt file | invalid | 2 | 2 | 0 | 100.0% | 134.8 ms |
| wrong type | invalid | 5 | 5 | 0 | 100.0% | 130.9 ms |
| unknown course | invalid | 11 | 11 | 0 | 100.0% | 210.2 ms |
| empty file | invalid | 9 | 9 | 0 | 100.0% | 127.1 ms |
| non-admin | invalid | 4 | 4 | 0 | 100.0% | 128.8 ms |
| valid PDF | valid | 9 | 9 | 0 | 100.0% | 350.2 ms |
| professor not teaching | invalid | 9 | 9 | 0 | 100.0% | 258.6 ms |
| too large | invalid | 1 | 1 | 0 | 100.0% | 207.8 ms |

### Catalog save

50 trials, 50 successes, 0 failures, 100.0%, average 230.7 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| invalid faculty fields | invalid | 10 | 10 | 0 | 100.0% | 134.0 ms |
| unknown professor | invalid | 6 | 6 | 0 | 100.0% | 377.9 ms |
| duplicate course code | invalid | 6 | 6 | 0 | 100.0% | 191.0 ms |
| duplicate term | invalid | 4 | 4 | 0 | 100.0% | 208.8 ms |
| student or visitor denied | invalid | 10 | 10 | 0 | 100.0% | 114.5 ms |
| unknown faculty | invalid | 5 | 5 | 0 | 100.0% | 260.3 ms |
| valid course | valid | 3 | 3 | 0 | 100.0% | 657.9 ms |
| invalid course fields | invalid | 2 | 2 | 0 | 100.0% | 134.3 ms |
| valid faculty, professor, or term | valid | 4 | 4 | 0 | 100.0% | 314.5 ms |

### File metadata save

50 trials, 50 successes, 0 failures, 100.0%, average 235.2 ms.

| Trial type | Input | Trials | Successes | Failures | Success rate | Avg response |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| invalid year | invalid | 5 | 5 | 0 | 100.0% | 212.0 ms |
| invalid exam type | invalid | 5 | 5 | 0 | 100.0% | 195.5 ms |
| student or visitor denied | invalid | 4 | 4 | 0 | 100.0% | 71.7 ms |
| no course | invalid | 2 | 2 | 0 | 100.0% | 196.2 ms |
| valid | valid | 4 | 4 | 0 | 100.0% | 403.7 ms |
| type on a material | invalid | 10 | 10 | 0 | 100.0% | 203.4 ms |
| unknown course | invalid | 4 | 4 | 0 | 100.0% | 270.2 ms |
| topic too long | invalid | 6 | 6 | 0 | 100.0% | 190.8 ms |
| professor not teaching | invalid | 10 | 10 | 0 | 100.0% | 317.0 ms |

## Failures

| Feature | Trial | Type | Input | Expected | Actual |
| --- | ---: | --- | --- | --- | --- |
| Search courses | 40 | special characters | SQL wildcards, quotes and markup taken literally — {"q":"%","facultyId":"","professorId":""} | 200 listing exactly the 0 matching course(s) | 200 listing 3 course(s): 0 missing, 3 unexpected |

## Database check

| Table | Before | After |
| --- | ---: | ---: |
| faculties | 2 | 2 |
| professors | 3 | 3 |
| terms | 3 | 3 |
| users | 1 | 1 |
| sessions | 292 | 292 |
| userCourses | 0 | 0 |
| courses | 3 | 3 |
| courseProfessors | 3 | 3 |
| courseFiles | 7 | 7 |
| logEntries | 58 | 58 |
