import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { getAuthTokenForUser } from './helpers';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

const app = createApp();

describe('Concurrency & Race Condition Behaviors', () => {
  let opsMemberToken: string;
  let opsLeadToken: string;
  let opsTeam: any;

  beforeAll(async () => {
    const member = await getAuthTokenForUser('member.ops@newtonite.internal');
    const lead = await getAuthTokenForUser('lead.ops@newtonite.internal');
    opsMemberToken = member.token;
    opsLeadToken = lead.token;
    opsTeam = await prisma.team.findFirst({ where: { name: { contains: 'Ops' } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('CRITICAL BEHAVIOR 1: Two users claiming the same unassigned item in parallel (Only one wins, second gets 409)', async () => {
    // 1. Create an unassigned work item
    const created = await prisma.workItem.create({
      data: {
        title: 'Concurrent Race Test Item',
        description: 'Test atomic claim behavior',
        type: WorkItemType.INCIDENT,
        priority: WorkItemPriority.URGENT,
        status: WorkItemStatus.OPEN,
        version: 1,
        teamId: opsTeam.id,
        createdById: (await prisma.user.findFirst({ where: { email: 'lead.ops@newtonite.internal' } }))!.id,
        assigneeId: null
      }
    });

    // 2. Fire two claim requests simultaneously via Promise.all
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/items/${created.id}/claim`)
        .set('Authorization', `Bearer ${opsMemberToken}`),
      request(app)
        .post(`/api/items/${created.id}/claim`)
        .set('Authorization', `Bearer ${opsLeadToken}`)
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one must succeed with 200, the loser must receive 409 Conflict
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;

    expect(winner.body.item.assigneeId).toBeTruthy();
    expect(loser.body.error).toMatch(/already been claimed|just claimed/);

    // Verify DB state has only one assignee
    const dbItem = await prisma.workItem.findUnique({ where: { id: created.id } });
    expect(dbItem?.assigneeId).toBe(winner.body.item.assigneeId);
  });

  test('CRITICAL BEHAVIOR 2: Optimistic Locking prevents stale edits (Stale version is rejected with 409)', async () => {
    // 1. Create an item with version 1
    const item = await prisma.workItem.create({
      data: {
        title: 'Optimistic Locking Item',
        description: 'Original content',
        type: WorkItemType.TASK,
        priority: WorkItemPriority.MEDIUM,
        status: WorkItemStatus.OPEN,
        version: 1,
        teamId: opsTeam.id,
        createdById: (await prisma.user.findFirst({ where: { email: 'lead.ops@newtonite.internal' } }))!.id
      }
    });

    // 2. User A successfully updates the item, advancing version to 2
    const resA = await request(app)
      .patch(`/api/items/${item.id}`)
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .send({
        version: 1,
        title: 'Title updated by User A'
      });

    expect(resA.status).toBe(200);
    expect(resA.body.version).toBe(2);

    // 3. User B sends an update with stale version 1
    const resB = await request(app)
      .patch(`/api/items/${item.id}`)
      .set('Authorization', `Bearer ${opsLeadToken}`)
      .send({
        version: 1, // Stale!
        title: 'Conflicting title by User B'
      });

    expect(resB.status).toBe(409);
    expect(resB.body.error).toMatch(/conflict|modified by another user/i);

    // 4. Verify DB item retained User A's update and was not overwritten by User B
    const finalItem = await prisma.workItem.findUnique({ where: { id: item.id } });
    expect(finalItem?.title).toBe('Title updated by User A');
    expect(finalItem?.version).toBe(2);
  });
});
