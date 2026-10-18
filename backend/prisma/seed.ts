import { PrismaClient, Role, WorkItemPriority, WorkItemStatus, WorkItemType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Seed Process ---');

  // Clean existing data
  await prisma.outboxJob.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Teams
  const teamsData = [
    { name: 'Core Infrastructure & Ops', description: 'Manages critical server clusters, networking, and deployment pipelines' },
    { name: 'Payments & Settlement', description: 'Handles transaction anomalies, chargebacks, and gateway reconciliations' },
    { name: 'Customer Escalations', description: 'Tier-3 technical triage for high-value enterprise accounts' },
    { name: 'Risk & Compliance', description: 'Regulatory audits, data security governance, and compliance reporting' }
  ];

  const teams = await Promise.all(
    teamsData.map(t => prisma.team.create({ data: t }))
  );
  console.log(`Created ${teams.length} teams.`);

  // 2. Create Users
  const usersData = [
    { email: 'admin@newtonite.internal', name: 'Alex Vance (Global Admin)' },
    { email: 'lead.ops@newtonite.internal', name: 'Sarah Connor (Ops Lead)' },
    { email: 'member.ops@newtonite.internal', name: 'Gordon Freeman (Ops Member)' },
    { email: 'viewer.ops@newtonite.internal', name: 'Eli Vance (Ops Viewer)' },
    { email: 'lead.payments@newtonite.internal', name: 'Rachel Green (Payments Lead)' },
    { email: 'member.payments@newtonite.internal', name: 'Chandler Bing (Payments Member)' },
    { email: 'lead.support@newtonite.internal', name: 'Ellen Ripley (Support Lead)' },
    { email: 'member.support@newtonite.internal', name: 'John McClane (Support Member)' },
    { email: 'lead.compliance@newtonite.internal', name: 'Dana Scully (Compliance Lead)' },
    { email: 'member.compliance@newtonite.internal', name: 'Fox Mulder (Compliance Member)' }
  ];

  const users = await Promise.all(
    usersData.map(u =>
      prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          passwordHash
        }
      })
    )
  );
  console.log(`Created ${users.length} users with standard password: password123`);

  // Map users
  const userMap = new Map(users.map(u => [u.email, u]));

  // 3. Create Team Memberships
  const membershipsData = [
    // Admin has Admin in all teams
    ...teams.map(t => ({ userEmail: 'admin@newtonite.internal', teamId: t.id, role: Role.ADMIN })),
    // Ops team
    { userEmail: 'lead.ops@newtonite.internal', teamId: teams[0].id, role: Role.LEAD },
    { userEmail: 'member.ops@newtonite.internal', teamId: teams[0].id, role: Role.MEMBER },
    { userEmail: 'viewer.ops@newtonite.internal', teamId: teams[0].id, role: Role.VIEWER },
    // Payments team
    { userEmail: 'lead.payments@newtonite.internal', teamId: teams[1].id, role: Role.LEAD },
    { userEmail: 'member.payments@newtonite.internal', teamId: teams[1].id, role: Role.MEMBER },
    // Support team
    { userEmail: 'lead.support@newtonite.internal', teamId: teams[2].id, role: Role.LEAD },
    { userEmail: 'member.support@newtonite.internal', teamId: teams[2].id, role: Role.MEMBER },
    // Compliance team
    { userEmail: 'lead.compliance@newtonite.internal', teamId: teams[3].id, role: Role.LEAD },
    { userEmail: 'member.compliance@newtonite.internal', teamId: teams[3].id, role: Role.MEMBER }
  ];

  for (const m of membershipsData) {
    const user = userMap.get(m.userEmail)!;
    await prisma.membership.create({
      data: {
        userId: user.id,
        teamId: m.teamId,
        role: m.role
      }
    });
  }
  console.log('Assigned team memberships across all 4 teams.');

  // 4. Create Curated Seed Items (demonstrating critical states)
  const opsTeam = teams[0];
  const opsLead = userMap.get('lead.ops@newtonite.internal')!;
  const opsMember = userMap.get('member.ops@newtonite.internal')!;

  const curatedItems = [
    {
      title: 'CRITICAL: Redis cluster memory exhaustion in eu-west-1',
      description: 'Memory usage hit 94% on primary shards. Need failover and eviction config check.',
      type: WorkItemType.INCIDENT,
      priority: WorkItemPriority.URGENT,
      status: WorkItemStatus.OPEN, // Unassigned urgent!
      teamId: opsTeam.id,
      createdById: opsLead.id,
      assigneeId: null
    },
    {
      title: 'Database connection pool saturation during morning spike',
      description: 'Max connections reached on write replica. Investigate leak in worker daemon.',
      type: WorkItemType.INCIDENT,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.IN_PROGRESS,
      teamId: opsTeam.id,
      createdById: opsLead.id,
      assigneeId: opsMember.id
    },
    {
      title: 'Infrastructure patch approval for Kernel CVE-2026-3829',
      description: 'Applied patch on staging. Needs Lead signoff before deploying to live cluster.',
      type: WorkItemType.TASK,
      priority: WorkItemPriority.HIGH,
      status: WorkItemStatus.AWAITING_APPROVAL, // Awaiting my approval!
      teamId: opsTeam.id,
      createdById: opsMember.id,
      assigneeId: opsLead.id
    },
    {
      title: 'Gateway timeout during webhook delivery to Partner B',
      description: 'Resolved by increasing HTTP keepalive timeout from 5s to 15s.',
      type: WorkItemType.CUSTOMER_ISSUE,
      priority: WorkItemPriority.MEDIUM,
      status: WorkItemStatus.RESOLVED,
      teamId: opsTeam.id,
      createdById: opsMember.id,
      assigneeId: opsMember.id
    }
  ];

  for (const item of curatedItems) {
    const created = await prisma.workItem.create({ data: item });
    await prisma.activityEvent.create({
      data: {
        workItemId: created.id,
        actorId: item.createdById,
        action: 'ITEM_CREATED',
        details: JSON.stringify({ message: `Item created with status ${item.status}` })
      }
    });
  }

  // 5. Bulk Generation (2,200 items to test cursor pagination & server-side filter performance)
  console.log('Generating 2,200 bulk work items across all teams...');
  const types: WorkItemType[] = [WorkItemType.INCIDENT, WorkItemType.CUSTOMER_ISSUE, WorkItemType.PAYMENT, WorkItemType.COMPLIANCE, WorkItemType.TASK];
  const priorities: WorkItemPriority[] = [WorkItemPriority.LOW, WorkItemPriority.MEDIUM, WorkItemPriority.HIGH, WorkItemPriority.URGENT];
  const statuses: WorkItemStatus[] = [WorkItemStatus.OPEN, WorkItemStatus.IN_PROGRESS, WorkItemStatus.AWAITING_APPROVAL, WorkItemStatus.RESOLVED, WorkItemStatus.CLOSED];

  const bulkItems: any[] = [];
  const baseTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago

  for (let i = 1; i <= 2200; i++) {
    const team = teams[i % teams.length];
    const creator = users[i % users.length];
    const isAssigned = i % 3 !== 0;
    const assignee = isAssigned ? users[(i + 1) % users.length] : null;
    const type = types[i % types.length];
    const priority = priorities[i % priorities.length];
    const status = statuses[i % statuses.length];
    const itemDate = new Date(baseTime + i * 1150000);

    bulkItems.push({
      title: `[${type}] Operations Task #${1000 + i}: Scheduled check for node-${(i % 50) + 1}`,
      description: `Automated maintenance and verification protocol executed for system partition ${(i % 12) + 1}.`,
      type,
      priority,
      status,
      version: 1,
      teamId: team.id,
      createdById: creator.id,
      assigneeId: assignee?.id || null,
      dueDate: new Date(Date.now() + (i % 14) * 86400000),
      createdAt: itemDate,
      updatedAt: itemDate
    });
  }

  // Batch insert
  const batchSize = 500;
  for (let i = 0; i < bulkItems.length; i += batchSize) {
    const chunk = bulkItems.slice(i, i + batchSize);
    await prisma.workItem.createMany({ data: chunk });
  }

  console.log('Successfully seeded 2,200+ work items.');
  console.log('--- Seed Finished Successfully ---');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
