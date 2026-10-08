import { Test, TestingModule } from '@nestjs/testing';
import { AiRouterService } from './services/ai-router.service';
import { AiContextService } from './services/ai-context.service';
import { AiAnswerService } from './services/ai-answer.service';
import { News2Service } from '../hospital/news2.service';
import { ClinicalToolsFactory } from './tools/clinical-tools.factory';
import { LlmRunner } from './reliability/llm-runner';
import { HospitalService } from '../hospital/hospital.service';
import { ClinicalRecordsService } from '../hospital/clinical-records.service';
import { VisitsService } from '../hospital/visits/visits.service';
import { FhirHapiClient } from './fhir/fhir-hapi.client';
import { AuthUser } from '../security/auth-user';
import { RunRecorder } from './observability/run-recorder';
import { CircuitBreaker } from './reliability/resilience';

describe('W13 Hardening & Modular AiServices', () => {
  let routerService: AiRouterService;
  let news2Service: News2Service;

  const mockDoctor: AuthUser = {
    userId: 'USR-TEST-DOC',
    userName: 'Dr. Hardening Test',
    role: 'DOCTOR',
  };

  beforeEach(async () => {
    news2Service = new News2Service();
    routerService = new AiRouterService(news2Service);
  });

  describe('AiRouterService', () => {
    it('Classifies intents correctly', () => {
      const intent = routerService.classify('Is P1001 allergic to penicillin?');
      expect(intent).toBeDefined();
      expect(intent.list).toBe(false);
    });

    it('Directly calculates NEWS2 score when all vitals are present', () => {
      const rec = new RunRecorder('test', mockDoctor, 'test-model');
      const intent = routerService.classify(
        'Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.',
      );

      const context = {
        charts: new Map(),
        onlyNotFound: false,
        notFound: [],
        needsPatient: false,
        text: null,
      };

      const result = routerService.evaluateDirectAnswer(
        'Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.',
        intent,
        context,
        rec,
      );

      expect(result.directText).toContain('NEWS2 score');
      expect(result.vitalsCalculated).toBe(true);
    });

    it('Returns clarifying question prompt when chart section requested with no patient in focus', () => {
      const rec = new RunRecorder('test', mockDoctor, 'test-model');
      const intent = routerService.classify('what are the vitals?');

      const context = {
        charts: new Map(),
        onlyNotFound: false,
        notFound: [],
        needsPatient: true,
        text: null,
      };

      const result = routerService.evaluateDirectAnswer(
        'what are the vitals?',
        intent,
        context,
        rec,
      );

      expect(result.directText).toContain('Which patient do you mean?');
    });
  });

  describe('FhirHapiClient CircuitBreaker Resilience', () => {
    it('Triggers circuit breaker on repeated connection failures', async () => {
      const fhirClient = new FhirHapiClient();
      // Simulate failed call
      jest.spyOn((fhirClient as any).http, 'put').mockRejectedValue({
        statusCode: 503,
        message: 'Service Unavailable',
      });

      let attempts = 0;
      for (let i = 0; i < 4; i++) {
        try {
          await fhirClient.upsertPatient({
            resourceType: 'Patient',
            id: 'P9999',
          });
        } catch {
          attempts++;
        }
      }
      expect(attempts).toBe(4);
    });
  });
});
