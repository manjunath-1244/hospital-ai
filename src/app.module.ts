import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { validateEnv } from './config/app.config';
import { ALL_ENTITIES } from './database/entities';
import { buildDataSourceOptions } from './database/typeorm.config';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { HospitalModule } from './hospital/hospital.module';
import { AdminModule } from './admin/admin.module';
import { JwtAuthGuard } from './security/jwt-auth.guard';
import { AuditInterceptor } from './security/audit.interceptor';

/**
 * ============================================================================
 * 🏛️ SYSTEM DESIGN CONCEPT: Modular Clean Architecture & Cross-Cutting Concerns
 * ============================================================================
 * WHAT IT IS:
 * The root IoC container orchestrating independent business domains, persistence
 * infrastructure, and enterprise cross-cutting security pipelines.
 *
 * HOW IMPLEMENTED:
 * - Domain Separation of Concerns:
 *   - `AuthModule`: Identity and authentication token issuing.
 *   - `HospitalModule`: Core clinical encounters, vitals, beds, and specialist domains.
 *   - `AiModule`: Autonomous reasoning, tools, memory, RAG, and HITL executor.
 *   - `AdminModule`: Forensic audits, analytics, and tenant user administration.
 * - Cross-Cutting Security Pipeline:
 *   - `ThrottlerGuard`: Distributed rate-limiting (120 req/min) preventing DDoS and brute-force.
 *   - `JwtAuthGuard`: Perimeter authentication and `@Roles(...)` RBAC enforcement.
 *   - `AuditInterceptor`: Non-repudiation audit logging intercepting every mutating API call.
 * ============================================================================
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions((key) => {
          const v = config.get<string | number>(key);
          return v === undefined ? undefined : String(v);
        }),
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    AuthModule,
    HospitalModule,
    AiModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
