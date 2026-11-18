import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, sql as pg } from '@/db/client';
import * as t from '@/db/schema';
import { ulid } from '@/lib/ids';
import { issueCredential, ensureIssuerKeys } from '@/lib/credentials/service';

const CAMPUS_SLUG = 'westbridge-institute';
const CAMPUS_NAME = 'Westbridge Institute of Technology';

async function main() {
  // A university is an organization — the campus vertical needs no new tenant model.
  let [campus] = await db.select().from(t.organizations).where(eq(t.organizations.slug, CAMPUS_SLUG)).limit(1);

  // Correct a campus seeded under an earlier name rather than leaving it.
  //
  // This seed is idempotent by slug, which used to mean the organization row was
  // written once and never revisited — so renaming the sample issuer changed the
  // constant here and nothing in the database, and the public verification API
  // went on returning the old name inside a signed credential it had signed.
  // Sample data that drifts from the seed claiming to produce it is worse than
  // none, because it looks like the seed ran.
  //
  // Matched on kind rather than on the previous slug: naming the old value here
  // would keep a retired identifier alive in the source forever, and the sample
  // set has exactly one campus, so "the campus that is not the current one" is
  // an unambiguous way to find it.
  if (!campus) {
    const campuses = await db.select().from(t.organizations).where(eq(t.organizations.kind, 'CAMPUS'));
    const stale = campuses.length === 1 ? campuses[0] : undefined;
    if (stale) {
      await db
        .update(t.organizations)
        .set({ slug: CAMPUS_SLUG, name: CAMPUS_NAME, updatedAt: new Date() })
        .where(eq(t.organizations.id, stale.id));
      [campus] = await db.select().from(t.organizations).where(eq(t.organizations.id, stale.id)).limit(1);
    }
  }

  if (!campus) {
    const id = ulid();
    await db.insert(t.organizations).values({
      id, slug: CAMPUS_SLUG, name: CAMPUS_NAME,
      kind: 'CAMPUS', status: 'ACTIVE',
    });
    [campus] = await db.select().from(t.organizations).where(eq(t.organizations.id, id)).limit(1);
  }
  await ensureIssuerKeys(campus!.id);

  let [type] = await db.select().from(t.credentialTypes)
    .where(eq(t.credentialTypes.key, 'student.enrolment')).limit(1);
  if (!type) {
    const id = ulid();
    await db.insert(t.credentialTypes).values({
      id, organizationId: campus!.id, key: 'student.enrolment',
      name: 'Student enrolment', category: 'QUALIFICATION',
      claimSchema: ['programme', 'year', 'enrolment_number', 'status'],
      discloseHolderName: true, defaultValidityDays: 365,
    });
    [type] = await db.select().from(t.credentialTypes).where(eq(t.credentialTypes.id, id)).limit(1);
  }

  const [holder] = await db.select().from(t.users).where(eq(t.users.email, 'meera@example.in')).limit(1);

  // One sample credential of this type, not one per run.
  //
  // A credential is signed over its claims, so a claim cannot be edited in
  // place — correcting one means issuing a new one. Without this the seed
  // accumulated a credential per invocation, and every superseded copy stayed
  // ACTIVE and publicly verifiable with whatever it was issued with.
  await db.delete(t.credentials).where(eq(t.credentials.credentialTypeId, type!.id));

  const issued = await issueCredential({
    organizationId: campus!.id,
    credentialTypeId: type!.id,
    holderUserId: holder!.id,
    holderName: 'Meera Kulkarni',
    claims: {
      programme: 'B.Tech Computer Science',
      year: 3,
      enrolment_number: 'WIT/CS/2023/0447',
      status: 'Enrolled',
    },
    issuedByUserId: holder!.id,
  });

  console.log('credential:', issued.publicRef);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pg.end());
