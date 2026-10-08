import { Module } from '@nestjs/common';
import { DataModule } from '../database/data.module';
import { HospitalModule } from '../hospital/hospital.module';
import { KnowledgeModule } from './rag/knowledge.module';
import { InteropModule } from './fhir/interop.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PhiAnonymizerService } from './security/phi-anonymizer.service';
import { ClinicalToolsFactory } from './tools/clinical-tools.factory';
import { LlmProvider } from './llm/llm-provider';
import { OllamaWarmupService } from './llm/warmup.service';
import { LlmRunner } from './reliability/llm-runner';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { SummarizerService } from './memory/summarizer.service';
import { AgentRunsService } from './observability/agent-runs.service';

@Module({
  imports: [DataModule, HospitalModule, KnowledgeModule, InteropModule],
  controllers: [AiController],
  providers: [
    AiService,
    PhiAnonymizerService,
    ClinicalToolsFactory,
    LlmProvider,
    OllamaWarmupService,
    LlmRunner,
    ConversationMemoryService,
    SummarizerService,
    AgentRunsService,
  ],
  exports: [
    AiService,
    LlmProvider,
    LlmRunner,
    AgentRunsService,
    ClinicalToolsFactory,
    ConversationMemoryService,
  ],
})
export class AiModule {}
