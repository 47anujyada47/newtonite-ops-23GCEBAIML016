import { prisma } from '../prisma';

export class OutboxWorker {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Process a batch of pending jobs from the transactional outbox table
   * Can be triggered on a loop or called directly in tests
   */
  static async processPendingJobs(batchSize = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;

    // Fetch batch of pending jobs with attempts remaining
    const jobs = await prisma.outboxJob.findMany({
      where: {
        status: 'PENDING',
        attempts: { lt: prisma.outboxJob.fields.maxAttempts }
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' }
    });

    if (jobs.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    for (const job of jobs) {
      try {
        // Mark job as PROCESSING
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: { status: 'PROCESSING', attempts: { increment: 1 } }
        });

        // Parse payload
        const payload = JSON.parse(job.payload);

        // Execute task based on jobType (e.g. simulated webhook / notifications)
        await this.executeJobHandler(job.jobType, payload);

        // Mark as COMPLETED
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            processedAt: new Date(),
            lastError: null
          }
        });
        succeeded++;
      } catch (err: any) {
        failed++;
        const currentJob = await prisma.outboxJob.findUnique({ where: { id: job.id } });
        const hasReachedMax = (currentJob?.attempts || 0) >= (currentJob?.maxAttempts || 3);

        await prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: hasReachedMax ? 'FAILED' : 'PENDING', // Requeue with backoff if attempts remain
            lastError: err.message || 'Execution failed'
          }
        });
      }
    }

    return { processed: jobs.length, succeeded, failed };
  }

  /**
   * Simulated idempotent job handler
   */
  private static async executeJobHandler(jobType: string, payload: any): Promise<void> {
    // Simulated delivery delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    switch (jobType) {
      case 'NOTIFY_ASSIGNEE':
        // In production: send email / Slack alert
        // console.log(`[Worker] Notification dispatched to assignee ${payload.recipientId} for work item: ${payload.title}`);
        break;

      case 'STATUS_NOTIFICATION':
        // console.log(`[Worker] Status change broadcast: ${payload.workItemId} moved from ${payload.oldStatus} -> ${payload.newStatus}`);
        break;

      case 'SIMULATED_FAILURE':
        throw new Error('Simulated external service error for retry testing');

      default:
        break;
    }
  }

  /**
   * Start recurring background polling loop
   */
  static start(pollIntervalMs = 2000) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[OutboxWorker] Worker started. Polling every ${pollIntervalMs}ms...`);

    this.intervalId = setInterval(async () => {
      try {
        await this.processPendingJobs();
      } catch (err) {
        console.error('[OutboxWorker] Error during polling iteration:', err);
      }
    }, pollIntervalMs);
  }

  /**
   * Stop recurring polling loop
   */
  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[OutboxWorker] Worker stopped.');
  }
}
