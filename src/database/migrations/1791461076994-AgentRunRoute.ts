import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentRunRoute1791461076994 implements MigrationInterface {
  name = 'AgentRunRoute1791461076994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "route" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "route"`);
  }
}
