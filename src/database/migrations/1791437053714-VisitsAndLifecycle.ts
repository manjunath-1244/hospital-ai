import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces VISITS (episodes of care).
 *
 * Before: `patients` carried the episode state (chiefComplaint, consultationStatus, consultedAt, waitAlertedAt, closed*).
 * After:  `patients` is the person; `visits` holds the episode; `visit_events` its timeline; every clinical record
 *         links to its visit through `visitId`.
 *
 * Data is carried over BEFORE the old columns are dropped: each existing patient becomes exactly one visit
 * (WAITING→TRIAGED/WAITING_TRIAGE, SEEN→IN_CONSULTATION, CLOSED→COMPLETED) and all their records are linked to it.
 */
export class VisitsAndLifecycle1791437053714 implements MigrationInterface {
  name = 'VisitsAndLifecycle1791437053714';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. new structures
    await queryRunner.query(
      `CREATE TABLE "visits" ("id" character varying NOT NULL, "patientId" character varying NOT NULL, "status" character varying NOT NULL, "chiefComplaint" character varying, "priority" integer, "department" character varying, "primaryDoctorId" character varying, "primaryDoctorName" character varying, "arrivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "triagedAt" TIMESTAMP WITH TIME ZONE, "consultationStartedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "waitAlertedAt" TIMESTAMP WITH TIME ZONE, "outcome" character varying, "closeReason" text, "createdBy" character varying NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0b0b322289a41015c6ea4e8bf30" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bfa22b367f591db46d899afd82" ON "visits"  ("patientId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b8126a0917fcddb0055edb0fb" ON "visits"  ("status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_visit_one_open_per_patient" ON "visits"  ("patientId") WHERE "status" IN ('WAITING_TRIAGE', 'TRIAGED', 'IN_CONSULTATION', 'UNDER_REVIEW', 'TREATMENT', 'FOLLOW_UP')`,
    );
    await queryRunner.query(
      `CREATE TABLE "visit_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "visitId" character varying NOT NULL, "fromStatus" character varying, "toStatus" character varying NOT NULL, "actorId" character varying NOT NULL, "actorName" character varying NOT NULL, "actorRole" character varying NOT NULL, "note" text, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_838efe2ff440ee0732127ca0a73" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea36021b7be6a27fc5936cc385" ON "visit_events"  ("visitId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "dobApproximate" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_results" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_tasks" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultations" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "vitals" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "vitals" ADD "symptoms" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "vitals" ADD "glucoseMgDl" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "imaging_studies" ADD "visitId" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b03d138c44e79589366679dc1a" ON "lab_results"  ("visitId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d0cb006a135a93b98fbd982d1" ON "appointments"  ("visitId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1dc3175961eded883c51ff5913" ON "staff_tasks"  ("visitId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5128ebb476306ba7db134101d" ON "consultations"  ("visitId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7c5f6f238ee15febf2c6f2b3a" ON "vitals"  ("visitId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5575737094c388e7510d977940" ON "imaging_studies"  ("visitId")`,
    );

    // 2. carry existing data into visits and link existing records
    await queryRunner.query(
      `INSERT INTO "visits" ("id","patientId","status","chiefComplaint","priority","arrivedAt","triagedAt","consultationStartedAt","completedAt","waitAlertedAt","outcome","closeReason","primaryDoctorId","primaryDoctorName","createdBy","updatedAt")
SELECT
  'V' || upper(substr(md5(p."id"), 1, 7)),
  p."id",
  CASE p."consultationStatus"
    WHEN 'CLOSED' THEN 'COMPLETED'
    WHEN 'SEEN' THEN 'IN_CONSULTATION'
    ELSE CASE WHEN EXISTS (SELECT 1 FROM "vitals" v WHERE v."patientId" = p."id") THEN 'TRIAGED' ELSE 'WAITING_TRIAGE' END
  END,
  p."chiefComplaint",
  NULL,
  p."registeredAt",
  (SELECT min(v."recordedAt") FROM "vitals" v WHERE v."patientId" = p."id"),
  p."consultedAt",
  p."closedAt",
  p."waitAlertedAt",
  CASE WHEN p."consultationStatus" = 'CLOSED' THEN 'CLOSED_BY_STAFF' END,
  p."closeReason",
  (SELECT c."doctorId" FROM "consultations" c WHERE c."patientId" = p."id" ORDER BY c."createdAt" LIMIT 1),
  (SELECT c."doctorName" FROM "consultations" c WHERE c."patientId" = p."id" ORDER BY c."createdAt" LIMIT 1),
  'migration',
  now()
FROM "patients" p`,
    );
    await queryRunner.query(
      `INSERT INTO "visit_events" ("visitId","fromStatus","toStatus","actorId","actorName","actorRole","note","at")
SELECT v."id", NULL, v."status", 'migration', 'Migration', 'SYSTEM', 'Backfilled from the patient record that existed before visits', v."arrivedAt"
FROM "visits" v`,
    );
    await queryRunner.query(
      `UPDATE "vitals" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );
    await queryRunner.query(
      `UPDATE "lab_results" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );
    await queryRunner.query(
      `UPDATE "imaging_studies" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );
    await queryRunner.query(
      `UPDATE "consultations" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );
    await queryRunner.query(
      `UPDATE "appointments" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );
    await queryRunner.query(
      `UPDATE "staff_tasks" r SET "visitId" = v."id" FROM "visits" v WHERE v."patientId" = r."patientId"`,
    );

    // 3. only now remove the episode columns from patients
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce46e19ba602d02c226d275de9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "chiefComplaint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "consultationStatus"`,
    );
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "consultedAt"`);
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "waitAlertedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "closedAt"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "closedBy"`);
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "closeReason"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. put the episode columns back on patients and restore them from each patient's latest visit
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "closeReason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "closedBy" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "closedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "waitAlertedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "consultedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "consultationStatus" character varying NOT NULL DEFAULT 'WAITING'`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "chiefComplaint" character varying`,
    );
    await queryRunner.query(
      `UPDATE "patients" p SET
  "chiefComplaint" = v."chiefComplaint",
  "consultationStatus" = CASE
    WHEN v."status" IN ('COMPLETED','CANCELLED','LEFT_WITHOUT_SEEN') THEN 'CLOSED'
    WHEN v."status" IN ('WAITING_TRIAGE','TRIAGED') THEN 'WAITING'
    ELSE 'SEEN' END,
  "consultedAt" = v."consultationStartedAt",
  "closedAt" = v."completedAt",
  "waitAlertedAt" = v."waitAlertedAt",
  "closeReason" = v."closeReason"
FROM (SELECT DISTINCT ON ("patientId") * FROM "visits" ORDER BY "patientId", "arrivedAt" DESC) v
WHERE v."patientId" = p."id"`,
    );

    // 2. remove the new structures
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5575737094c388e7510d977940"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7c5f6f238ee15febf2c6f2b3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a5128ebb476306ba7db134101d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1dc3175961eded883c51ff5913"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d0cb006a135a93b98fbd982d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b03d138c44e79589366679dc1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "imaging_studies" DROP COLUMN "visitId"`,
    );
    await queryRunner.query(`ALTER TABLE "vitals" DROP COLUMN "glucoseMgDl"`);
    await queryRunner.query(`ALTER TABLE "vitals" DROP COLUMN "symptoms"`);
    await queryRunner.query(`ALTER TABLE "vitals" DROP COLUMN "visitId"`);
    await queryRunner.query(
      `ALTER TABLE "consultations" DROP COLUMN "visitId"`,
    );
    await queryRunner.query(`ALTER TABLE "staff_tasks" DROP COLUMN "visitId"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "visitId"`);
    await queryRunner.query(`ALTER TABLE "lab_results" DROP COLUMN "visitId"`);
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "dobApproximate"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea36021b7be6a27fc5936cc385"`,
    );
    await queryRunner.query(`DROP TABLE "visit_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_visit_one_open_per_patient"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b8126a0917fcddb0055edb0fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfa22b367f591db46d899afd82"`,
    );
    await queryRunner.query(`DROP TABLE "visits"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_ce46e19ba602d02c226d275de9" ON "patients" USING btree ("consultationStatus")`,
    );
  }
}
