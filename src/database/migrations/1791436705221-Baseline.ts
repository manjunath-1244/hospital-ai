import { MigrationInterface, QueryRunner } from 'typeorm';

export class Baseline1791436705221 implements MigrationInterface {
  name = 'Baseline1791436705221';

  /**
   * Baseline = the schema as it was when migrations were introduced.
   * Databases created earlier by the old auto-sync already contain these tables; for them this migration only
   * records itself as applied (nothing is created or changed).
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ exists }] = await queryRunner.query(
      `SELECT to_regclass('public.patients') IS NOT NULL AS exists`,
    );
    if (exists) return;
    await queryRunner.query(
      `CREATE TABLE "patients" ("id" character varying NOT NULL, "name" character varying NOT NULL, "age" integer NOT NULL, "gender" character varying NOT NULL, "dob" character varying NOT NULL, "phone" character varying NOT NULL, "bloodType" character varying NOT NULL, "allergies" jsonb NOT NULL DEFAULT '[]', "currentMedications" jsonb NOT NULL DEFAULT '[]', "conditions" jsonb NOT NULL DEFAULT '[]', "chiefComplaint" character varying, "consultationStatus" character varying NOT NULL DEFAULT 'WAITING', "registeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "consultedAt" TIMESTAMP WITH TIME ZONE, "waitAlertedAt" TIMESTAMP WITH TIME ZONE, "fhirSynced" boolean NOT NULL DEFAULT false, "closedAt" TIMESTAMP WITH TIME ZONE, "closedBy" character varying, "closeReason" character varying, CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce46e19ba602d02c226d275de9" ON "patients"  ("consultationStatus") `,
    );
    await queryRunner.query(
      `CREATE TABLE "lab_results" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "testName" character varying NOT NULL, "value" character varying NOT NULL, "unit" character varying NOT NULL, "referenceRange" character varying NOT NULL, "status" character varying NOT NULL, "date" character varying NOT NULL, "recordedBy" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4f1c5b3b5813c98fb531e5db738" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba17bac03c7dfad8a5c5613ff1" ON "lab_results"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "appointments" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "doctorName" character varying NOT NULL, "department" character varying NOT NULL, "dateTime" character varying NOT NULL, "status" character varying NOT NULL, "reason" character varying NOT NULL, CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13c2e57cb81b44f062ba24df57" ON "appointments"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_appointment_doctor_slot" ON "appointments"  ("doctorName", "dateTime") WHERE "status" = 'SCHEDULED'`,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_tasks" ("id" character varying NOT NULL, "title" character varying NOT NULL, "assignedTo" character varying NOT NULL, "patientId" character varying, "priority" character varying NOT NULL, "status" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9a4229738b0fe632286aeab5983" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" character varying NOT NULL, "username" character varying NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "role" character varying NOT NULL, CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "consultations" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "doctorId" character varying NOT NULL, "doctorName" character varying NOT NULL, "diagnosis" text NOT NULL, "prescriptions" jsonb NOT NULL DEFAULT '[]', "notes" text NOT NULL, "safety" jsonb, "overrideReason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c5b78e9424d9bc68464f6a12103" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a00f58f9b1e75d30d66ee4097d" ON "consultations"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "vitals" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "heartRate" integer NOT NULL, "bpSystolic" integer NOT NULL, "spO2" integer NOT NULL, "tempCelsius" double precision NOT NULL, "respiratoryRate" integer NOT NULL, "painScore" integer, "consciousness" character varying NOT NULL, "onSupplementalO2" boolean NOT NULL, "news2Score" integer NOT NULL, "riskLevel" character varying NOT NULL, "recordedBy" character varying NOT NULL, "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a6f02e68a2c1766b720d065dfd8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18d995ee0fc66f9ebded708850" ON "vitals"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "imaging_studies" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "studyInstanceUid" character varying NOT NULL, "seriesInstanceUid" character varying, "modality" character varying NOT NULL, "description" character varying, "impression" text, "rows" integer, "columns" integer, "studyDate" character varying, "orthancInstanceId" character varying, "fhirId" character varying, "uploadedBy" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ce09b5345976a0e5572a97b1032" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7bfaf2cd7409f6349aa6fc22e" ON "imaging_studies"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "role" character varying NOT NULL, "method" character varying NOT NULL, "path" character varying NOT NULL, "patientId" character varying, "statusCode" integer NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d5fd0fd3e774a259b2ded889b" ON "audit_logs"  ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_threads" ("id" character varying NOT NULL, "userId" character varying NOT NULL, "title" character varying NOT NULL, "summary" text, "summarizedCount" integer NOT NULL DEFAULT '0', "activePatientId" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_973a81c0adb9b18a5ea3ef95bf8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5da06fbf4f3a13457becba6e53" ON "chat_threads"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "threadId" character varying NOT NULL, "role" character varying NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2ac4c23281c85c64f16ff0548" ON "chat_messages"  ("threadId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_runs" ("id" character varying NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying NOT NULL, "userId" character varying NOT NULL, "userRole" character varying NOT NULL, "threadId" character varying, "model" character varying NOT NULL, "status" character varying NOT NULL, "durationMs" integer NOT NULL, "guardrailStatus" character varying, "guardrailNotes" jsonb NOT NULL DEFAULT '[]', "retries" integer NOT NULL DEFAULT '0', "error" text, "usage" jsonb, "steps" jsonb NOT NULL DEFAULT '[]', "toolCallCount" integer NOT NULL DEFAULT '0', "toolFailureCount" integer NOT NULL DEFAULT '0', "toolNames" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_442f7e0ec4ae860cf17edc57825" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf2875d557894ba9ba0961f6e4" ON "agent_runs"  ("at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_documents" ("id" character varying NOT NULL, "title" character varying NOT NULL, "filename" character varying NOT NULL, "content" text NOT NULL, "sizeBytes" integer NOT NULL, "uploadedBy" character varying NOT NULL, "ragSource" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_402a3c43fb263aa5289670e4e21" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "knowledge_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf2875d557894ba9ba0961f6e4"`,
    );
    await queryRunner.query(`DROP TABLE "agent_runs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2ac4c23281c85c64f16ff0548"`,
    );
    await queryRunner.query(`DROP TABLE "chat_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5da06fbf4f3a13457becba6e53"`,
    );
    await queryRunner.query(`DROP TABLE "chat_threads"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d5fd0fd3e774a259b2ded889b"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7bfaf2cd7409f6349aa6fc22e"`,
    );
    await queryRunner.query(`DROP TABLE "imaging_studies"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18d995ee0fc66f9ebded708850"`,
    );
    await queryRunner.query(`DROP TABLE "vitals"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a00f58f9b1e75d30d66ee4097d"`,
    );
    await queryRunner.query(`DROP TABLE "consultations"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "staff_tasks"`);
    await queryRunner.query(`DROP INDEX "public"."uq_appointment_doctor_slot"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13c2e57cb81b44f062ba24df57"`,
    );
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba17bac03c7dfad8a5c5613ff1"`,
    );
    await queryRunner.query(`DROP TABLE "lab_results"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce46e19ba602d02c226d275de9"`,
    );
    await queryRunner.query(`DROP TABLE "patients"`);
  }
}
