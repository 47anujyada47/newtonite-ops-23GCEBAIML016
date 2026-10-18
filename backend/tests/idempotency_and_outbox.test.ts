import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { getAuthTokenForUser } from './helpers';
import { OutboxWorker } from '../src/services/outboxWorker';
import { WorkItemPriority, WorkItemType } from '@prisma/client';

const app = createApp();

describe('Idempotency & Transactional Outbox Behaviors', () => {
  let opsMemberToken: string;
  let opsTeam: any;

  beforeAll(async () => {
    const member = await getAuthTokenForUser('member.ops@newtonite.internal');
    opsMemberToken = member.token;
    opsTeam = await prisma.team.findFirst({ where: { name: { contains: 'Ops' } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('CRITICAL BEHAVIOR 6: Idempotent requests (Duplicate request with same Idempotency-Key creates exactly one item)', async () => {
    const idempotencyKey = `test-key-${Date.now()}-${Math.random()}`;
    const payload = {
      title: 'Idempotency Test Item',
      description: 'Created with unique idempotency key',
      type: WorkItemType.TASK,
      priority: WorkItemPriority.MEDIUM,
      teamId: opsTeam.id
    };

    // 1. First request
    const res1 = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    const createdItemId = res1.body.id;

    // 2. Second request with the identical key (simulating network retry or double click)
    const res2 = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.headers['x-cache']).toBe('HIT-IDEMPOTENT');
    expect(res2.body.id).toBe(createdItemId);

    // 3. Verify exactly ONE database record exists
    const count = await prisma.workItem.count({
      where: { title: 'Idempotency Test Item' }
    });
    expect(count).toBe(1);
  });

  test('CRITICAL BEHAVIOR 7: Transactional Outbox ensures atomic job creation and reliable processing', async () => {
    const member = await prisma.user.findFirst({ where: { email: 'member.ops@newtonite.internal' } });

    // 1. Create work item with assignee
    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .send({
        title: 'Outbox Test Work Item',
        description: 'Verify background job is queued in same transaction',
        type: WorkItemType.INCIDENT,
        priority: WorkItemPriority.HIGH,
        teamId: opsTeam.id,
        assigneeId: member!.id
      });

    expect(res.status).toBe(201);
    const itemId = res.body.id;

    // 2. Verify an outbox job was created in the database for this item
    const outboxJob = await prisma.outboxJob.findFirst({
      where: {
        payload: { contains: itemId },
        status: 'PENDING'
      }
    });

    expect(outboxJob).toBeTruthy();
    expect(outboxJob?.jobType).toBe('NOTIFY_ASSIGNEE');
    expect(outboxJob?.attempts).toBe(0);

    // 3. Run worker processing loop once
    const result = await OutboxWorker.processPendingJobs(10);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    // 4. Verify job is now marked COMPLETED with processedAt timestamp
    const processedJob = await prisma.outboxJob.findUnique({
      where: { id: outboxJob!.id }
    });

    expect(processedJob?.status).toBe('COMPLETED');
    expect(processedJob?.processedAt).toBeTruthy();
    expect(processedJob?.attempts).toBe(1);
  });
});
