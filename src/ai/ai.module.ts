import { Module } from '@nestjs/common';
import { DataModule } from '../database/data.module';
import { HospitalModule } from '../hospital/hospital.module';
import { KnowledgeModule } from './rag/knowledge.module';
import { InteropModule } from './fhir/interop.module';
import { ActionsModule } from './actions/actions.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRouterService } from './services/ai-router.service';
import { AiContextService } from './services/ai-context.service';
import { AiAnswerService } from './services/ai-answer.service';
import { PhiAnonymizerService } from './security/phi-anonymizer.service';
import { ClinicalToolsFactory } from './tools/clinical-tools.factory';
import { LlmProvider } from './llm/llm-provider';
import { OllamaWarmupService } from './llm/warmup.service';
import { LlmRunner } from './reliability/llm-runner';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { SummarizerService } from './memory/summarizer.service';
import { AgentContextBuilder } from './context/agent-context.builder';
import { AgentRunsService } from './observability/agent-runs.service';

@Module({
  imports: [
    DataModule,
    HospitalModule,
    KnowledgeModule,
    InteropModule,
    ActionsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiRouterService,
    AiContextService,
    AiAnswerService,
    PhiAnonymizerService,
    ClinicalToolsFactory,
    LlmProvider,
    OllamaWarmupService,
    LlmRunner,
    ConversationMemoryService,
    SummarizerService,
    AgentRunsService,
    AgentContextBuilder,
  ],
  exports: [
    AiService,
    AiRouterService,
    AiContextService,
    AiAnswerService,
    LlmProvider,
    LlmRunner,
    AgentRunsService,
    ClinicalToolsFactory,
    ConversationMemoryService,
    ActionsModule,
  ],
})
export class AiModule {}
