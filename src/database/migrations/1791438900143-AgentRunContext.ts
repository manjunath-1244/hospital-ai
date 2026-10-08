import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentRunContext1791438900143 implements MigrationInterface {
  name = 'AgentRunContext1791438900143';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_runs" ADD "contextHash" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "context" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "context"`);
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP COLUMN "contextHash"`,
    );
  }
}
