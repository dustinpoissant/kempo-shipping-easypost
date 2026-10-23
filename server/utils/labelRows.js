import db from 'kempo/server/db/index.js';
import { and, asc, eq } from 'drizzle-orm';
import { kempoEasypostLabel } from '../db/schema.js';

/* The labels in the database: read for an order, saved when bought, and updated when a refund is asked for. */
export const listLabels = async orderId => {
  try {
    return [null, await db.select().from(kempoEasypostLabel).where(eq(kempoEasypostLabel.orderId, orderId)).orderBy(asc(kempoEasypostLabel.purchasedAt))];
  } catch {
    return [{ code: 500, msg: 'The labels could not be read' }, null];
  }
};

export const getLabel = async (orderId, id) => {
  try {
    const [row] = await db.select().from(kempoEasypostLabel).where(and(eq(kempoEasypostLabel.orderId, orderId), eq(kempoEasypostLabel.id, id)));
    return row ? [null, row] : [{ code: 404, msg: 'Label not found' }, null];
  } catch {
    return [{ code: 500, msg: 'The label could not be read' }, null];
  }
};

export const saveLabel = async row => {
  try {
    await db.insert(kempoEasypostLabel).values(row);
    return [null, row];
  } catch(error) {
    return [{ code: 500, msg: `The label was bought but could not be saved: ${error.message}` }, null];
  }
};

export const updateLabel = async (id, changes) => {
  try {
    const [row] = await db.update(kempoEasypostLabel).set(changes).where(eq(kempoEasypostLabel.id, id)).returning();
    return [null, row];
  } catch {
    return [{ code: 500, msg: 'The label could not be updated' }, null];
  }
};
