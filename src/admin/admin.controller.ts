import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { KnowledgeDocumentsService } from '../ai/rag/knowledge-documents.service';
import { FhirDicomIngestService } from '../ai/rag/fhir-dicom-ingest.service';
import { AuthUser, CurrentUser } from '../security/auth-user';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Roles } from '../security/roles.decorator';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { FhirHapiClient } from '../ai/fhir/fhir-hapi.client';
import { OrthancClient } from '../ai/dicom/orthanc.client';
import { EmbeddingProvider } from '../ai/rag/embedding.provider';
import { VectorStore } from '../ai/rag/pgvector-rag.service';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';
import { llmProviderName, resolveModel } from '../ai/llm/model';
import { AgentRunsService } from '../ai/observability/agent-runs.service';
import { LlmRunner } from '../ai/reliability/llm-runner';

export class KnowledgeUploadDto {
  @IsOptional() @IsString() @MaxLength(150) title?: string;
  @IsOptional() @IsString() @MaxLength(250_000) content?: string;
  @IsOptional() @IsString() @MaxLength(200) filename?: string;
}

type Status = 'UP' | 'DOWN';
interface ServiceHealth {
  name: string;
  status: Status;
  latencyMs: number;
  details: string;
}

async function probe(
  name: string,
  fn: () => Promise<string>,
): Promise<ServiceHealth> {
  const t = Date.now();
  try {
    const details = await fn();
    return { name, status: 'UP', latencyMs: Date.now() - t, details };
  } catch (err: any) {
    return {
      name,
      status: 'DOWN',
      latencyMs: Date.now() - t,
      details: err?.message ?? 'unreachable',
    };
  }
}

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly ds: DataSource,
    private readonly fhir: FhirHapiClient,
    private readonly orthanc: OrthancClient,
    private readonly embedder: EmbeddingProvider,
    private readonly vectors: VectorStore,
    private readonly events: HospitalEventsGateway,
    private readonly runs: AgentRunsService,
    private readonly llmRunner: LlmRunner,
    private readonly knowledge: KnowledgeDocumentsService,
    private readonly ingest: FhirDicomIngestService,
    @InjectRepository(AuditLogEntity)
    private readonly audit: Repository<AuditLogEntity>,
  ) {}

  @Get('health')
  async health() {
    const services = await Promise.all([
      probe('PostgreSQL', async () => {
        await this.ds.query('SELECT 1');
        return 'query ok';
      }),
      probe('pgvector (RAG store)', async () => {
        const ext = await this.ds.query(
          `SELECT extversion FROM pg_extension WHERE extname='vector'`,
        );
        if (!ext.length) throw new Error('vector extension not installed');
        return `v${ext[0].extversion}, ${await this.vectors.count()} chunks, embeddings: ${this.embedder.modelId}`;
      }),
      probe('HAPI FHIR R4', async () => {
        await this.fhir.ping();
        return process.env.FHIR_SERVER_URL ?? 'http://localhost:8080/fhir';
      }),
      probe('Orthanc PACS', async () => {
        await this.orthanc.ping();
        return process.env.ORTHANC_URL ?? 'http://localhost:8042';
      }),
      probe(
        'WebSockets',
        async () => `${this.events.connectedClients} connected client(s)`,
      ),
      probe('LLM provider', async () => {
        if (!resolveModel())
          throw new Error(`${llmProviderName()}: API key not configured`);
        return `${llmProviderName()} configured`;
      }),
    ]);
    return { checkedAt: new Date().toISOString(), services };
  }

  @Get('audit-logs')
  auditLogs(@Query('limit') limit?: string) {
    const take = Math.min(
      Math.max(parseInt(limit ?? '100', 10) || 100, 1),
      500,
    );
    return this.audit.find({ order: { at: 'DESC' }, take });
  }

  // --- Agent observability ---
  @Get('agent/metrics')
  async agentMetrics(@Query('hours') hours?: string) {
    const h = Math.min(Math.max(parseInt(hours ?? '24', 10) || 24, 1), 168);
    return {
      ...(await this.runs.metrics(h)),
      breaker: this.llmRunner.breakerSnapshot(),
    };
  }

  @Get('agent/runs')
  agentRuns(@Query('limit') limit?: string) {
    return this.runs.list(parseInt(limit ?? '50', 10) || 50);
  }

  @Get('agent/runs/:id')
  agentRun(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Get('agent/proposals/metrics')
  agentProposalMetrics(@Query('hours') hours?: string) {
    const h = Math.min(Math.max(parseInt(hours ?? '24', 10) || 24, 1), 168);
    return this.runs.proposalMetrics(h);
  }

  // --- Agent knowledge: documents the admin uploads become searchable by the agent immediately ---
  @Get('knowledge')
  listKnowledge() {
    return this.knowledge.list();
  }

  @Post('knowledge')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async addKnowledge(
    @Body() dto: KnowledgeUploadDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (file) {
      const filename = Buffer.from(file.originalname, 'latin1').toString(
        'utf8',
      );
      const content = await this.knowledge.extractText(filename, file.buffer);
      return this.knowledge.add({
        title: dto.title,
        filename,
        content,
        uploadedBy: user.userName,
      });
    }
    if (!dto.content)
      throw new BadRequestException(
        'Provide a file (field "file") or JSON { title, content }.',
      );
    const filename = `${(dto.title ?? 'pasted-document').replace(/[^\w.-]+/g, '-').slice(0, 80)}.md`;
    return this.knowledge.add({
      title: dto.title,
      filename,
      content: dto.content,
      uploadedBy: user.userName,
    });
  }

  @Delete('knowledge/:id')
  removeKnowledge(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }

  @Post('knowledge/reindex')
  async reindexKnowledge() {
    const docs = await this.knowledge.reindexDocuments();
    const records = await this.ingest.reindexAll();
    return {
      success: true,
      documents: docs.documents,
      chunks: docs.chunks,
      patients: records.patients,
    };
  }
}
