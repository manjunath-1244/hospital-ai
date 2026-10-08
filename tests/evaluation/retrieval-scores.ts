import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { VectorRagService } from '../../src/ai/rag/vector-rag.service';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const rag = app.get(VectorRagService);
  const qs = [
    'What should we do when a patient gets a rash after a drug?',
    'how long must vitals be stable before discharge',
    'hello how are you',
    'what is the capital of France',
    'tell me a joke',
    'thanks',
    'who won the cricket match',
    'what is the visiting hours policy',
    'sepsis treatment antibiotics timing',
    'how do I reset my password',
  ];
  for (const q of qs) {
    const h = await rag.searchPolicies(q, 2);
    console.log(
      q.padEnd(62),
      h.map((x) => `${x.score} ${x.source.slice(0, 22)}`).join(' | '),
    );
  }
  await app.close();
})();
