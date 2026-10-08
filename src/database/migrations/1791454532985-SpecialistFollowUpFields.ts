import { MigrationInterface, QueryRunner } from "typeorm";

export class SpecialistFollowUpFields1791454532985 implements MigrationInterface {
    name = 'SpecialistFollowUpFields1791454532985'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "specialist_assessments" ADD "followUpTests" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "specialist_assessments" ADD "followUpDays" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "specialist_assessments" DROP COLUMN "followUpDays"`);
        await queryRunner.query(`ALTER TABLE "specialist_assessments" DROP COLUMN "followUpTests"`);
    }

}
