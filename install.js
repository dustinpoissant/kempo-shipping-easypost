import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  The table of labels bought (server/db/schema.js). kempo creates the tables of a fresh install from the schema, but an update
  never adds one to a database that already exists, and its generated CREATE TABLE leaves out the indexes, so both are made here
  with IF NOT EXISTS (safe on every install and update). The unique index on the shipment is what stops one EasyPost shipment
  being recorded twice.
*/
const STATEMENTS = [
  sql`CREATE TABLE IF NOT EXISTS "kempoEasypostLabel" ("id" text PRIMARY KEY NOT NULL, "orderId" text NOT NULL, "shipmentRef" text NOT NULL, "rateRef" text DEFAULT '' NOT NULL, "carrier" text NOT NULL, "service" text NOT NULL, "serviceLabel" text NOT NULL, "trackingCode" text NOT NULL, "trackingUrl" text, "publicTrackingUrl" text, "labelUrl" text NOT NULL, "labelPdfUrl" text, "cost" integer NOT NULL, "currency" text DEFAULT 'USD' NOT NULL, "mode" text DEFAULT 'test' NOT NULL, "parcel" jsonb, "status" text DEFAULT 'purchased' NOT NULL, "refundStatus" text, "purchasedAt" timestamp NOT NULL, "purchasedBy" text)`,
  sql`CREATE INDEX IF NOT EXISTS "kempoEasypostLabel_order_idx" ON "kempoEasypostLabel" ("orderId")`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoEasypostLabel_shipment_idx" ON "kempoEasypostLabel" ("shipmentRef")`,
];

/*
  Creates the table, and warns when kempo cannot store the API key. Without SETTINGS_ENCRYPTION_KEY the extension does nothing
  until one is set, because the key is a secret setting.
*/
export default async () => {
  for(const statement of STATEMENTS){
    try {
      await db.execute(statement);
    } catch(error) {
      throw new Error(`[kempo-shipping-easypost] Could not create the labels table: ${error.message}`);
    }
  }

  if(!process.env.SETTINGS_ENCRYPTION_KEY){
    console.warn([
      '[kempo-shipping-easypost] SETTINGS_ENCRYPTION_KEY is not set, so the EasyPost API key cannot be stored.',
      '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      '  Put it in .env, restart, then reinstall this extension.',
    ].join('\n'));
    return;
  }
  console.log('[kempo-shipping-easypost] Installed. Add your EasyPost API key on the EasyPost tab at /admin/extension/kempo-shipping/.');
};
