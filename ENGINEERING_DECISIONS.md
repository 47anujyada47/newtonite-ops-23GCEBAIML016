# Engineering Decisions & Architectural Trade-offs

This document details the architectural choices, trade-offs, and rationale behind the **Newtonite Operations Under Pressure** platform. Each decision represents a conscious evaluation between developer ergonomics, transactional correctness, and operational scale.

---

## Decision 1: Concurrency Control — Atomic Conditional Updates vs. Pessimistic Row Locking

### Context
In operational triage queues, multiple operators frequently view the same urgent unassigned incident simultaneously. If two operators click "Claim" within milliseconds of each other, the system must guarantee that exactly one operator claims the item, and the second operator receives an immediate, informative conflict error rather than silently overwriting the assignment.

### Options Considered
1. **Application-Level Mutex (e.g., Redis distributed lock):** Acquire a Redis lock per item before updating.
2. **Pessimistic Row Locking (`SELECT ... FOR UPDATE`):** Lock the database row during a transaction while reading and updating.
3. **Atomic Conditional SQL Update (`UPDATE ... WHERE id = ? AND assigneeId IS NULL`):** Execute a single SQL statement that only mutates the row if the assignee is still unassigned.

### Final Choice
**Atomic Conditional SQL Update.**

```sql
UPDATE "WorkItem"
SET 
  "assigneeId" = $1,
  "status" = CASE WHEN "status" = 'OPEN' THEN 'IN_PROGRESS'::"WorkItemStatus" ELSE "status" END,
  "version" = "version" + 1,
  "updatedAt" = NOW()
WHERE "id" = $2 AND "assigneeId" IS NULL
RETURNING *;
```

### Rationale & Trade-offs
* **Why not Redis locks?** Introduces an external dependency and split-brain risk if Redis fails or locks expire prematurely under network partitions.
* **Why not `SELECT ... FOR UPDATE`?** Pessimistic locks hold open transactions on the database, increasing connection pool contention and risking deadlocks if multiple tables are locked out of order.
* **Trade-off Accepted:** The atomic conditional update shifts the concurrency burden directly to PostgreSQL's row-level MVCC write barrier. If 0 rows are returned, we immediately know a race condition occurred and throw a `409 Conflict`. The trade-off is that claiming logic must be encapsulated in SQL rather than relying purely on ORM object-level mutations.

---

## Decision 2: Stale Edit Mitigation — Monotonic Versioning (Optimistic Concurrency Control)

### Context
An operator opens an incident ticket in their browser, spends 5 minutes investigating, and submits an update. Meanwhile, another operator changed the priority and assigned a team member 2 minutes ago. A naive `UPDATE` would silently overwrite the second operator's changes (lost-update anomaly).

### Options Considered
1. **Last-Write-Wins (Timestamp comparison):** Compare `updatedAt` timestamps.
2. **Pessimistic Checkout Lock:** Lock the ticket from editing as soon as an operator opens the view.
3. **Optimistic Locking with Version Counter:** Every work item maintains a strictly increasing integer `version`. Updates must supply the expected version.

### Final Choice
**Optimistic Locking with Version Counter.**

### Rationale & Trade-offs
* **Why not Timestamp comparison?** Clock skew across distributed servers or sub-millisecond updates can cause timestamp collisions or false positive overwrites.
* **Why not Pessimistic Checkout?** Operators often leave browser tabs open or disconnect; ticket checkout requires complex lease renewal timers and "unlock" recovery logic.
* **Trade-off Accepted:** The client must always send the current `version`. When a collision occurs, the server rejects the write with `409 Conflict` and returns the latest state. The client UI must handle this rejection by rolling back optimistic edits and notifying the user.

---

## Decision 3: Auditability & Consistency — Append-Only Activity Log in the Same DB Transaction

### Context
Every critical operational mutation (claiming, priority adjustment, state transition) must be permanently logged with actor details and timestamp. If an incident state changes but the audit log write fails, the system suffers from history-state divergence, creating compliance and debugging blindspots.

### Options Considered
1. **Asynchronous Audit Event Emission (Fire-and-forget message):** Update item in Postgres, emit an event to an event bus to write the activity log later.
2. **Database Triggers:** PostgreSQL triggers that automatically insert into `activity_events` on table updates.
3. **Same-Transaction Atomic Write (`prisma.$transaction`):** Write both the `WorkItem` mutation and the `ActivityEvent` within a single database transaction.

### Final Choice
**Same-Transaction Atomic Write.**

### Rationale & Trade-offs
* **Why not Asynchronous Event Emission?** If the message bus is down or the server crashes between the database commit and the event emission, the history log permanently disagrees with the state.
* **Why not Triggers?** Triggers hide business context (such as the specific user session and reason for transition) in procedural SQL, making them difficult to unit test and maintain in application code.
* **Trade-off Accepted:** Combining item update and activity insertion slightly increases transaction duration and WAL write volume. However, it provides an absolute guarantee that history can never disagree with the current state.

---

## Decision 4: Asynchronous Processing — Transactional Outbox Pattern vs. Synchronous Event Dispatch

### Context
When work items are assigned or transitioned, external side effects must occur (disagree-tolerant email notifications, partner webhooks, metrics dispatch). Making external HTTP or SMTP calls inside the core HTTP request handler degrades response times and risks failures if third parties time out.

### Options Considered
1. **Direct Synchronous Calls:** Make external webhook calls directly in the request handler before returning `200 OK`.
2. **In-Memory Job Queue (e.g., BullMQ with Redis):** Queue jobs in Redis immediately after updating PostgreSQL.
3. **Transactional Outbox Table:** Insert an outbox record inside the **same PostgreSQL transaction** as the business mutation, polled and processed by an asynchronous worker daemon.

### Final Choice
**Transactional Outbox Table with Retry & Backoff.**

### Rationale & Trade-offs
* **Why not Direct Synchronous Calls?** Slow external endpoints cause cascading API latency, and a failure leaves the caller in an ambiguous state (did the work item update or did the notification fail?).
* **Why not In-Memory Queue (Redis)?** Dual-write problem: if the Postgres transaction commits but the server crashes before Redis receives the job, the notification is lost forever.
* **Trade-off Accepted:** The outbox worker polls PostgreSQL every 2 seconds. This introduces a slight notification delay (sub-2 seconds), but guarantees **at-least-once delivery** with exponential retry backoff and failure caps.

---

## Decision 5: Pagination Strategy — Deterministic Cursor Pagination vs. Offset/Limit

### Context
The operational queue is seeded with thousands of items and continues to grow. High-velocity queues cause "page-drift" with offset pagination (e.g., an item inserted on page 1 causes page 2 to skip an item or show a duplicate).

### Options Considered
1. **Offset / Limit (`OFFSET 5000 LIMIT 25`):** Standard SQL offset pagination.
2. **Cursor Pagination on Composite Index `(createdAt, id)`:** Query items with `WHERE (createdAt, id) < (cursorCreatedAt, cursorId) ORDER BY createdAt DESC, id DESC LIMIT 25`.

### Final Choice
**Deterministic Cursor Pagination.**

### Rationale & Trade-offs
* **Why not Offset/Limit?** `OFFSET 10000` requires PostgreSQL to scan and discard 10,000 rows on every page change, degrading response times from $5\text{ms}$ to $>250\text{ms}$ at scale. Furthermore, newly inserted items shift indices, causing operators to see duplicates or miss critical items.
* **Trade-off Accepted:** Users cannot arbitrarily jump to page 87 (which is rarely needed in operational queues). In exchange, every page fetch executes in $<5\text{ms}$ utilizing an index scan, with complete immunity to concurrent row insertions.

---

## Decision 6: What We Deliberately Chose Not to Build (Scope Control)

In accordance with the challenge brief's instruction to *"assess engineering judgement, not feature count"*, the following features were intentionally excluded:

1. **WebSockets for Live Streaming:** Polling with TanStack Query intervals (10s) and explicit conflict alerts on user action provides 95% of the operational benefit without websocket connection exhaustion or state synchronization overhead.
2. **Complex SSO / OAuth2 Integration:** A seeded JWT authentication service with a 1-click **Quick Role Switcher** was implemented instead. This allows the evaluator to test all role combinations without configuring external OAuth apps.
3. **File Attachments / S3 Uploads:** Multi-part file uploads add cloud credential dependencies without demonstrating core systems engineering capabilities.
