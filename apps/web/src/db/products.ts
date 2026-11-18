/**
 * Product ownership (D-007): the physical thing, who owns it now, and how it
 * changed hands.
 *
 * A receipt says what was bought. It does not say who owns the item *today* —
 * and after the first resale those are different people. A product instance is
 * the item itself, created from the receipt line that evidences its purchase,
 * with exactly one current owner.
 *
 * **Double ownership is unrepresentable rather than prevented.** There is one
 * `owner_user_id` column, not an ownership table that two rows could both claim;
 * a transfer rewrites that column inside a transaction that has locked the row.
 * The history of who owned it lives in `ownership_transfers`, which is only ever
 * appended to.
 */
import {
  char,
  index,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, users } from './schema';
import { receiptLines, receipts, warranties } from './commerce';

const id = () => char('id', { length: 26 }).primaryKey();
const fk = (name: string) => char(name, { length: 26 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const now = () => ts('created_at').defaultNow().notNull();

export const acquisition = pgEnum('product_acquisition', ['PURCHASE', 'TRANSFER']);
export const transferState = pgEnum('ownership_transfer_state', ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED']);

export const productInstances = pgTable(
  'product_instances',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),

    /** The evidence of purchase. Every instance starts on a receipt line. */
    receiptId: fk('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'restrict' }),
    receiptLineId: fk('receipt_line_id')
      .notNull()
      .references(() => receiptLines.id, { onDelete: 'restrict' }),
    /** 1…quantity — which of the units on that line this is. */
    unitIndex: smallint('unit_index').default(1).notNull(),
    /** Who sold it. */
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    productName: varchar('product_name', { length: 240 }).notNull(),
    sku: varchar('sku', { length: 80 }),
    /** Only when the line was for exactly one unit: a serial names one item. */
    serialNumber: varchar('serial_number', { length: 120 }),
    /** The warranty that covers *this* unit, when the line derived one for a single unit. */
    warrantyId: fk('warranty_id').references(() => warranties.id, { onDelete: 'set null' }),

    ownerUserId: fk('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** The buyer on the receipt, who keeps the receipt whatever happens next. */
    purchaserUserId: fk('purchaser_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acquiredVia: acquisition('acquired_via').default('PURCHASE').notNull(),
    acquiredAt: ts('acquired_at').notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('product_instances_public_ref_key').on(t.publicRef),
    uniqueIndex('product_instances_line_unit_key').on(t.receiptLineId, t.unitIndex),
    index('product_instances_owner_idx').on(t.ownerUserId, t.acquiredAt),
  ],
);

export const ownershipTransfers = pgTable(
  'ownership_transfers',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    productInstanceId: fk('product_instance_id')
      .notNull()
      .references(() => productInstances.id, { onDelete: 'cascade' }),
    fromUserId: fk('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Unknown until the code is claimed — the sender shares a code, not an address. */
    toUserId: fk('to_user_id').references(() => users.id, { onDelete: 'restrict' }),
    state: transferState('state').default('PENDING').notNull(),
    /** SHA-256 of the transfer code, hex. The code itself is shown once and never stored. */
    claimCodeHash: varchar('claim_code_hash', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    cancelledAt: ts('cancelled_at'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('ownership_transfers_public_ref_key').on(t.publicRef),
    uniqueIndex('ownership_transfers_code_key').on(t.claimCodeHash),
    // One live offer per item: two outstanding codes for the same laptop would
    // let it be "sold" twice.
    uniqueIndex('ownership_transfers_one_pending')
      .on(t.productInstanceId)
      .where(sql`${t.state} = 'PENDING'`),
    index('ownership_transfers_from_idx').on(t.fromUserId, t.createdAt),
  ],
);
