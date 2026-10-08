import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentWorkflowTables1791447322347 implements MigrationInterface {
  name = 'AgentWorkflowTables1791447322347';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "agent_actions" ("id" character varying NOT NULL, "threadId" character varying, "traceId" character varying, "proposedByUserId" character varying NOT NULL, "proposedByRole" character varying NOT NULL, "patientId" character varying, "visitId" character varying, "type" character varying NOT NULL, "tier" character varying NOT NULL DEFAULT 'ASK', "payload" jsonb NOT NULL, "summary" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "decidedByUserId" character varying, "decidedAt" TIMESTAMP WITH TIME ZONE, "decisionNote" character varying, "result" jsonb, "verification" jsonb, "idempotencyKey" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e044df4a9b58e69c2fd29a06990" UNIQUE ("idempotencyKey"), CONSTRAINT "PK_0cff9bcbdc6e9555059903a3f10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b17fcd7cfb4d3f22c1b540183e" ON "agent_actions"  ("patientId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97a9c88a62893a139e202acc8b" ON "agent_actions"  ("proposedByUserId", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "consultation_requests" ("id" character varying(32) NOT NULL, "visitId" character varying(32) NOT NULL, "patientId" character varying(32) NOT NULL, "requestedById" character varying(64) NOT NULL, "requestedByName" character varying(128) NOT NULL, "specialty" character varying(64) NOT NULL, "assignedSpecialistId" character varying(64), "assignedSpecialistName" character varying(128), "urgency" character varying(16) NOT NULL DEFAULT 'ROUTINE', "reason" text NOT NULL, "aiRationale" text, "evidence" jsonb, "status" character varying(24) NOT NULL DEFAULT 'REQUESTED', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "acceptedAt" TIMESTAMP, "completedAt" TIMESTAMP, "cancelledAt" TIMESTAMP, "cancellationReason" text, CONSTRAINT "PK_b241fc32bd9f9f7cb3dd41b1f5b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cr_visit_id" ON "consultation_requests"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cr_patient_id" ON "consultation_requests"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cr_specialty" ON "consultation_requests"  ("specialty") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cr_assigned_specialist" ON "consultation_requests"  ("assignedSpecialistId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cr_status" ON "consultation_requests"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" character varying(64) NOT NULL, "recipientUserId" character varying(64), "recipientPatientId" character varying(32), "type" character varying(64) NOT NULL, "title" character varying(256) NOT NULL, "body" text NOT NULL, "payload" jsonb, "channel" character varying(24) NOT NULL DEFAULT 'IN_APP', "readAt" TIMESTAMP, "deliveredAt" TIMESTAMP, "sourceActionId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notif_recipient_user" ON "notifications"  ("recipientUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notif_recipient_patient" ON "notifications"  ("recipientPatientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notif_created_at" ON "notifications"  ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_notices" ("id" character varying(64) NOT NULL, "patientId" character varying(32) NOT NULL, "visitId" character varying(32), "channel" character varying(16) NOT NULL DEFAULT 'STUB', "recipientContact" character varying(128), "message" text NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'SENT', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cf444720b5d211aa1a4552e18e8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pn_patient_id" ON "patient_notices"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "specialist_assessments" ("id" character varying(32) NOT NULL, "requestId" character varying(32) NOT NULL, "visitId" character varying(32) NOT NULL, "patientId" character varying(32) NOT NULL, "authorId" character varying(64) NOT NULL, "authorName" character varying(128) NOT NULL, "specialty" character varying(64) NOT NULL, "assessment" text NOT NULL, "recommendation" text NOT NULL, "treatment" text NOT NULL, "followUp" text NOT NULL, "completedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0e5da37a059fb6701a3d22f53ed" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sa_request_id" ON "specialist_assessments"  ("requestId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sa_visit_id" ON "specialist_assessments"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sa_patient_id" ON "specialist_assessments"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "follow_up_plans" ("id" character varying(32) NOT NULL, "visitId" character varying(32) NOT NULL, "patientId" character varying(32) NOT NULL, "createdFromRequestId" character varying(64), "items" jsonb NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_293a6a3ab7915ef0beb1e42baee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fup_visit_id" ON "follow_up_plans"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fup_patient_id" ON "follow_up_plans"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "lab_orders" ("id" character varying(32) NOT NULL, "visitId" character varying(32) NOT NULL, "patientId" character varying(32) NOT NULL, "testName" character varying(128) NOT NULL, "orderedById" character varying(64) NOT NULL, "orderedByName" character varying(128) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'ORDERED', "resultId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a488d533e758e6ba02958198f1c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lo_visit_id" ON "lab_orders"  ("visitId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lo_patient_id" ON "lab_orders"  ("patientId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "decisions" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "actionIds" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "actionIds" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ALTER COLUMN "decisions" DROP NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_lo_patient_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lo_visit_id"`);
    await queryRunner.query(`DROP TABLE "lab_orders"`);
    await queryRunner.query(`DROP INDEX "public"."idx_fup_patient_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_fup_visit_id"`);
    await queryRunner.query(`DROP TABLE "follow_up_plans"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sa_patient_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sa_visit_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sa_request_id"`);
    await queryRunner.query(`DROP TABLE "specialist_assessments"`);
    await queryRunner.query(`DROP INDEX "public"."idx_pn_patient_id"`);
    await queryRunner.query(`DROP TABLE "patient_notices"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notif_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_notif_recipient_patient"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_notif_recipient_user"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cr_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cr_assigned_specialist"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cr_specialty"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cr_patient_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_cr_visit_id"`);
    await queryRunner.query(`DROP TABLE "consultation_requests"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97a9c88a62893a139e202acc8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b17fcd7cfb4d3f22c1b540183e"`,
    );
    await queryRunner.query(`DROP TABLE "agent_actions"`);
  }
}
