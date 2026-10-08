import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeDocumentEntity } from '../../database/entities/knowledge-document.entity';
import { VectorRagService } from './vector-rag.service';
import { newId } from '../../common/ids';

const MAX_CHARS = 200_000;
const TEXT_EXT = new Set(['.md', '.markdown', '.txt']);

export interface KnowledgeDocView {
  id: string;
  title: string;
  filename: string;
  origin: 'builtin' | 'uploaded';
  sizeBytes: number;
  chunkCount: number;
  uploadedBy: string | null;
  createdAt: Date | null;
}

/**
 * Admin-managed hospital documents. Uploaded text is stored in Postgres (source of truth) and indexed into the vector
 * store immediately, so the agent can answer from it on the very next question. Files in /knowledge are built-in seeds.
 */
@Injectable()
export class KnowledgeDocumentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeDocumentsService.name);
  private readonly dir = path.join(process.cwd(), 'knowledge');

  constructor(
    @InjectRepository(KnowledgeDocumentEntity)
    private readonly docs: Repository<KnowledgeDocumentEntity>,
    private readonly rag: VectorRagService,
  ) {}

  async onApplicationBootstrap() {
    // Re-embed uploaded documents (unchanged chunks are skipped) so a changed embedding model never leaves them stale.
    try {
      for (const d of await this.docs.find()) await this.index(d);
    } catch (err: any) {
      this.logger.error(
        `Re-indexing uploaded documents failed: ${err.message}`,
      );
    }
  }

  private index(d: KnowledgeDocumentEntity) {
    return this.rag.ingest({
      source: d.ragSource,
      heading: d.title,
      text: `# ${d.title}\n\n${d.content}`,
      kind: 'policy',
    });
  }

  async extractText(filename: string, buffer: Buffer): Promise<string> {
    const ext = path.extname(filename).toLowerCase();
    if (TEXT_EXT.has(ext)) return buffer.toString('utf-8');
    if (ext === '.pdf') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          return (await parser.getText()).text as string;
        } finally {
          await parser.destroy?.();
        }
      } catch {
        throw new BadRequestException(
          'Could not read this PDF (is it a scanned image or password protected?). Upload a text-based PDF, .md or .txt.',
        );
      }
    }
    throw new BadRequestException(
      'Unsupported file type. Upload .md, .txt or .pdf, or paste the text.',
    );
  }

  async add(input: {
    title?: string;
    filename: string;
    content: string;
    uploadedBy: string;
  }): Promise<KnowledgeDocView> {
    const content = input.content
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .trim();
    if (content.length < 20)
      throw new BadRequestException(
        'The document is empty or too short to be useful.',
      );
    if (content.length > MAX_CHARS)
      throw new BadRequestException(
        `Document too long (${content.length} characters, max ${MAX_CHARS}).`,
      );

    const id = newId('KB-', 6);
    const title = (
      input.title?.trim() ||
      path.basename(input.filename, path.extname(input.filename))
    ).slice(0, 150);
    const entity = this.docs.create({
      id,
      title,
      filename: input.filename.slice(0, 200),
      content,
      sizeBytes: Buffer.byteLength(content),
      uploadedBy: input.uploadedBy,
      ragSource: `${input.filename.slice(0, 120)} (${id})`,
    });
    await this.docs.save(entity);
    try {
      await this.index(entity);
    } catch (err: any) {
      await this.docs.delete({ id }); // no half-state: either it is stored AND searchable, or neither
      await this.rag.removeSource(entity.ragSource).catch(() => undefined);
      throw new BadRequestException(
        `Indexing failed, document not saved: ${err.message}`,
      );
    }
    const saved = await this.docs.findOneOrFail({ where: { id } });
    return this.toView(
      saved,
      await this.rag.chunkCountForSource(saved.ragSource),
    );
  }

  async remove(id: string) {
    const d = await this.docs.findOne({ where: { id } });
    if (!d) {
      const builtin =
        fs.existsSync(this.dir) && fs.readdirSync(this.dir).includes(id);
      if (builtin)
        throw new BadRequestException(
          'Built-in documents cannot be deleted here.',
        );
      throw new NotFoundException('Document not found');
    }
    await this.rag.removeSource(d.ragSource);
    await this.docs.delete({ id });
    return { success: true };
  }

  async list(): Promise<KnowledgeDocView[]> {
    const out: KnowledgeDocView[] = [];
    if (fs.existsSync(this.dir)) {
      for (const f of fs
        .readdirSync(this.dir)
        .filter((x) => x.endsWith('.md'))
        .sort()) {
        out.push({
          id: f,
          title: f.replace(/\.md$/, '').replace(/[-_]/g, ' '),
          filename: f,
          origin: 'builtin',
          sizeBytes: fs.statSync(path.join(this.dir, f)).size,
          chunkCount: await this.rag.chunkCountForSource(f),
          uploadedBy: null,
          createdAt: null,
        });
      }
    }
    for (const d of await this.docs.find({ order: { createdAt: 'DESC' } })) {
      out.push(this.toView(d, await this.rag.chunkCountForSource(d.ragSource)));
    }
    return out;
  }

  /** Re-index built-in and uploaded documents. */
  async reindexDocuments() {
    await this.rag.indexKnowledgeBase();
    const uploaded = await this.docs.find();
    let chunks = 0;
    for (const d of uploaded) chunks += await this.index(d);
    return { documents: uploaded.length, chunks };
  }

  private toView(
    d: KnowledgeDocumentEntity,
    chunkCount: number,
  ): KnowledgeDocView {
    return {
      id: d.id,
      title: d.title,
      filename: d.filename,
      origin: 'uploaded',
      sizeBytes: d.sizeBytes,
      chunkCount,
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt,
    };
  }
}
