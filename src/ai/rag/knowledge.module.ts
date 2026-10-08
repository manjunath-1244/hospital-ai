import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DataModule } from '../../database/data.module';
import {
  createEmbeddingProvider,
  EmbeddingProvider,
} from './embedding.provider';
import { PgVectorStore, VectorStore } from './pgvector-rag.service';
import { VectorRagService } from './vector-rag.service';
import { InteropModule } from '../fhir/interop.module';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { FhirDicomIngestService } from './fhir-dicom-ingest.service';

@Module({
  imports: [DataModule, InteropModule],
  providers: [
    {
      provide: EmbeddingProvider,
      useFactory: async () => createEmbeddingProvider(),
    },
    {
      provide: VectorStore,
      inject: [DataSource, EmbeddingProvider],
      useFactory: async (ds: DataSource, emb: EmbeddingProvider) => {
        const store = new PgVectorStore(ds, emb);
        await store.init(); // schema must exist before VectorRagService.onModuleInit indexes
        return store;
      },
    },
    VectorRagService,
    FhirDicomIngestService,
    KnowledgeDocumentsService,
  ],
  exports: [
    EmbeddingProvider,
    VectorStore,
    VectorRagService,
    KnowledgeDocumentsService,
    FhirDicomIngestService,
  ],
})
export class KnowledgeModule {}
