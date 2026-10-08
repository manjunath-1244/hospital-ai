import { MigrationInterface, QueryRunner } from 'typeorm';

export class Specialists1791438298966 implements MigrationInterface {
  name = 'Specialists1791438298966';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "doctor_availability" ("id" character varying NOT NULL, "doctorId" character varying NOT NULL, "weekday" integer NOT NULL, "startTime" character varying(5) NOT NULL, "endTime" character varying(5) NOT NULL, "slotMinutes" integer NOT NULL DEFAULT '30', CONSTRAINT "PK_3d2b4ffe9085f8c7f9f269aed89" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ebf8396e8918307342d6bcf82" ON "doctor_availability"  ("doctorId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "doctorId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "specialty" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "department" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "isAvailable" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_appointment_doctorid_slot" ON "appointments"  ("doctorId", "dateTime") WHERE "status" = 'SCHEDULED' AND "doctorId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_appointment_doctorid_slot"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isAvailable"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "department"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "specialty"`);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "doctorId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ebf8396e8918307342d6bcf82"`,
    );
    await queryRunner.query(`DROP TABLE "doctor_availability"`);
  }
}
