import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { getAuthTokenForUser } from './helpers';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';

const app = createApp();

describe('Workflow State Machine & Scoped RBAC Authorization', () => {
  let opsMemberToken: string;
  let opsLeadToken: string;
  let paymentsMemberToken: string;
  let opsTeam: any;
  let paymentsTeam: any;

  beforeAll(async () => {
    const member = await getAuthTokenForUser('member.ops@newtonite.internal');
    const lead = await getAuthTokenForUser('lead.ops@newtonite.internal');
    const payments = await getAuthTokenForUser('member.payments@newtonite.internal');

    opsMemberToken = member.token;
    opsLeadToken = lead.token;
    paymentsMemberToken = payments.token;

    opsTeam = await prisma.team.findFirst({ where: { name: { contains: 'Ops' } } });
    paymentsTeam = await prisma.team.findFirst({ where: { name: { contains: 'Payments' } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('CRITICAL BEHAVIOR 3: Invalid workflow state jump is rejected (e.g. OPEN -> CLOSED directly)', async () => {
    const item = await prisma.workItem.create({
      data: {
        title: 'State Jump Test',
        type: WorkItemType.TASK,
        priority: WorkItemPriority.LOW,
        status: WorkItemStatus.OPEN,
        version: 1,
        teamId: opsTeam.id,
        createdById: (await prisma.user.findFirst({ where: { email: 'lead.ops@newtonite.internal' } }))!.id
      }
    });

    // Attempt invalid jump from OPEN to CLOSED
    const res = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .send({
        status: WorkItemStatus.CLOSED,
        version: 1
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid workflow transition/i);
  });

  test('CRITICAL BEHAVIOR 4: Approval gate requires Team Lead role (Regular Member cannot approve to RESOLVED)', async () => {
    const item = await prisma.workItem.create({
      data: {
        title: 'Approval Gate Test',
        type: WorkItemType.INCIDENT,
        priority: WorkItemPriority.HIGH,
        status: WorkItemStatus.AWAITING_APPROVAL,
        version: 1,
        teamId: opsTeam.id,
        createdById: (await prisma.user.findFirst({ where: { email: 'member.ops@newtonite.internal' } }))!.id
      }
    });

    // 1. Regular Member tries to transition to RESOLVED -> Rejected with 403
    const resMember = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${opsMemberToken}`)
      .send({
        status: WorkItemStatus.RESOLVED,
        version: 1
      });

    expect(resMember.status).toBe(403);
    expect(resMember.body.error).toMatch(/Only team Leads or Admins/i);

    // 2. Team Lead transitions to RESOLVED -> Succeeds with 200
    const resLead = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set('Authorization', `Bearer ${opsLeadToken}`)
      .send({
        status: WorkItemStatus.RESOLVED,
        version: 1
      });

    expect(resLead.status).toBe(200);
    expect(resLead.body.item.status).toBe(WorkItemStatus.RESOLVED);
  });

  test('CRITICAL BEHAVIOR 5: Resource-level multi-team authorization (User from another team gets 403 on item access)', async () => {
    // Item belongs to Payments team
    const paymentsItem = await prisma.workItem.create({
      data: {
        title: 'Confidential Settlement Issue',
        type: WorkItemType.PAYMENT,
        priority: WorkItemPriority.HIGH,
        status: WorkItemStatus.OPEN,
        version: 1,
        teamId: paymentsTeam.id,
        createdById: (await prisma.user.findFirst({ where: { email: 'lead.payments@newtonite.internal' } }))!.id
      }
    });

    // Ops Member (not a member of Payments) tries to access Payments item
    const resForbidden = await request(app)
      .get(`/api/items/${paymentsItem.id}`)
      .set('Authorization', `Bearer ${opsMemberToken}`);

    expect(resForbidden.status).toBe(403);
    expect(resForbidden.body.error).toMatch(/access denied|do not belong/i);

    // Payments Member accesses same item -> 200 OK
    const resAllowed = await request(app)
      .get(`/api/items/${paymentsItem.id}`)
      .set('Authorization', `Bearer ${paymentsMemberToken}`);

    expect(resAllowed.status).toBe(200);
    expect(resAllowed.body.id).toBe(paymentsItem.id);
  });
});
