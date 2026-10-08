import { Module } from '@nestjs/common';
import { DataModule } from '../database/data.module';
import { KnowledgeModule } from '../ai/rag/knowledge.module';
import { InteropModule } from '../ai/fhir/interop.module';
import { EventsModule } from '../events/events.module';
import { AiModule } from '../ai/ai.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [DataModule, KnowledgeModule, InteropModule, EventsModule, AiModule],
  controllers: [AdminController],
})
export class AdminModule {}
