import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runWithTenant } from '../src/core/tenant';
import { MemberProfileModel } from '../src/modules/members/model';
import { applyDuePlanChanges } from '../src/modules/members/planChange';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();
const DAY = 86_400_000;

async function setup(validDays = 30) {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
  const admin = await signedInAgent(app, 'owner@city.test');
  const gold = (
    await admin.post('/api/membership-plans').send({
      name: 'Gold',
      price: 49_900,
      durationDays: 90,
      bookLimit: 4,
      finePerDay: 500,
      tier: 'gold',
    })
  ).body;
  const silver = (
    await admin.post('/api/membership-plans').send({
      name: 'Silver',
      price: 19_900,
      durationDays: 30,
      bookLimit: 2,
      finePerDay: 500,
    })
  ).body;
  const m = await activeMember(app, lib.id, 'reader@city.test', { validDays });
  const profile = () =>
    runWithTenant(lib.id, () => MemberProfileModel.findById(m.profile._id).lean());
  const buy = (planId: string) =>
    admin
      .post('/api/payments/counter')
      .send({ memberToken: m.token, method: 'cash', purpose: 'membership', planId });
  return { lib, admin, gold, silver, m, profile, buy };
}

describe('plan changes take effect when the current period ends', () => {
  it('a different plan bought mid-period is scheduled; the card keeps the current plan', async () => {
    const { lib, gold, m, profile, buy } = await setup();
    const before = (await profile())!;
    expect((await buy(gold.id)).status).toBe(201);

    const p = (await profile())!;
    expect(String(p.planId)).toBe(String(before.planId)); // unchanged for now
    expect(p.cardTier).toBe('member');
    expect(String(p.nextPlan?.planId)).toBe(gold.id);
    expect(p.nextPlan?.startsAt.getTime()).toBe(before.validTill!.getTime());
    // No days are lost: the new plan's 90 days follow the current period.
    expect(p.validTill!.getTime()).toBe(before.validTill!.getTime() + 90 * DAY);

    const me = (await m.agent.get('/api/member/profile')).body;
    expect(me.nextPlan).toEqual({
      planId: gold.id,
      planName: 'Gold',
      startsAt: before.validTill!.toISOString(),
    });
    expect((await m.agent.get('/api/member/celebration')).body.celebration).toMatchObject({
      planName: 'Gold',
      startsAt: before.validTill!.toISOString(),
    });
    expect(testOutbox.at(-1)?.text).toMatch(
      /Your Gold plan starts on .*, when your current plan ends/,
    );

    // Nothing switches early; at the end date the job moves the card to Gold.
    expect(await runWithTenant(lib.id, () => applyDuePlanChanges())).toBe(0);
    const switched = await runWithTenant(lib.id, () =>
      applyDuePlanChanges(new Date(before.validTill!.getTime() + 1000)),
    );
    expect(switched).toBe(1);
    const after = (await profile())!;
    expect(String(after.planId)).toBe(gold.id);
    expect(after.cardTier).toBe('gold');
    expect(after.nextPlan).toBeNull();
    expect(after.currentPeriodStart?.getTime()).toBe(before.validTill!.getTime());
  });

  it('while a change is scheduled only more of that plan can be bought', async () => {
    const { gold, silver, profile, buy } = await setup();
    await buy(gold.id);
    const scheduled = (await profile())!;

    const blocked = await buy(silver.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PLAN_CHANGE_PENDING');
    expect(blocked.body.error.message).toMatch(/^Gold already starts on /);

    expect((await buy(gold.id)).status).toBe(201);
    const p = (await profile())!;
    expect(p.validTill!.getTime()).toBe(scheduled.validTill!.getTime() + 90 * DAY);
    expect(p.nextPlan?.startsAt.getTime()).toBe(scheduled.nextPlan!.startsAt.getTime());
  });

  it('renewing the same plan extends it; with no running plan a new one starts now', async () => {
    const renew = await setup();
    const before = (await renew.profile())!;
    expect((await renew.buy(String(before.planId))).status).toBe(201);
    const renewed = (await renew.profile())!;
    expect(renewed.nextPlan).toBeNull();
    expect(renewed.validTill!.getTime()).toBe(before.validTill!.getTime() + 30 * DAY);
  });

  it('an expired member switches plan immediately', async () => {
    const { gold, profile, buy } = await setup(-5);
    expect((await buy(gold.id)).status).toBe(201);
    const p = (await profile())!;
    expect(String(p.planId)).toBe(gold.id);
    expect(p.cardTier).toBe('gold');
    expect(p.nextPlan).toBeNull();
    expect(p.validTill!.getTime()).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it('reads switch a due plan even before the job runs', async () => {
    const { lib, gold, m, buy } = await setup();
    await buy(gold.id);
    await runWithTenant(lib.id, () =>
      MemberProfileModel.updateOne(
        { _id: m.profile._id },
        { $set: { 'nextPlan.startsAt': new Date(Date.now() - 1000) } },
      ),
    );
    const me = (await m.agent.get('/api/member/profile')).body;
    expect(me).toMatchObject({ planName: 'Gold', cardTier: 'gold', nextPlan: null });
  });
});
