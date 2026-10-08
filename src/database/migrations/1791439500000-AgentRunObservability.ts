import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentRunObservability1791439500000 implements MigrationInterface {
  name = 'AgentRunObservability1791439500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "goal" text`);
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD "decisions" jsonb DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD "actionIds" jsonb DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "actionIds"`);
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "decisions"`);
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "goal"`);
  }
}
