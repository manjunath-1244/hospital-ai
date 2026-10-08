import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { validateEnv } from './config/app.config';
import { ALL_ENTITIES } from './database/entities';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { HospitalModule } from './hospital/hospital.module';
import { AdminModule } from './admin/admin.module';
import { JwtAuthGuard } from './security/jwt-auth.guard';
import { AuditInterceptor } from './security/audit.interceptor';

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
      useFactory: (c: ConfigService) => ({
        type: 'postgres' as const,
        host: c.getOrThrow<string>('DB_HOST'),
        port: c.getOrThrow<number>('DB_PORT'),
        username: c.getOrThrow<string>('DB_USER'),
        password: c.getOrThrow<string>('DB_PASSWORD'),
        database: c.getOrThrow<string>('DB_NAME'),
        entities: ALL_ENTITIES,
        // Schema auto-sync is for development only; production must use migrations.
        synchronize: c.get('NODE_ENV') !== 'production',
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
