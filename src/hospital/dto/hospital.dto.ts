import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  VISIT_OUTCOMES,
  VISIT_STATUSES,
  type VisitOutcome,
  type VisitStatus,
} from '../visits/visit-status';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const patientIdRule = /^[A-Za-z0-9-]{2,32}$/;

export class RegistrationDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  /** Required unless a real date of birth is given (then the age is computed from it). */
  @ValidateIf((o) => !o.dob)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  age?: number;
  @IsOptional() @IsISO8601({ strict: true }) dob?: string;
  @Transform(lower) @IsIn(['male', 'female', 'other']) gender: string;
  @Transform(trim)
  @Matches(/^\+?[\d\s\-().]{7,24}$/, {
    message: 'phone must be a valid phone number',
  })
  phone: string;
  @Transform(trim)
  @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
  bloodType: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  chiefComplaint?: string;
  /** Set to true after the receptionist reviewed the possible matches and confirmed this is a different person. */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

export class StartVisitDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  chiefComplaint?: string;
}

export class VisitTransitionDto {
  @IsIn(VISIT_STATUSES) to: VisitStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
  @IsOptional()
  @IsIn(VISIT_OUTCOMES)
  outcome?: VisitOutcome;
}

export class ConsultationDto {
  @Matches(patientIdRule) patientId: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  doctorName?: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(500) diagnosis: string;
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  prescriptions: string[];
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) notes: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  overrideReason?: string;
}

export const CONSCIOUSNESS = [
  'ALERT',
  'CONFUSION',
  'VOICE',
  'PAIN',
  'UNRESPONSIVE',
] as const;

export class TriageDto {
  @Matches(patientIdRule) patientId: string;
  /** Defaults to the patient's open visit. */
  @IsOptional() @Matches(patientIdRule) visitId?: string;
  @Type(() => Number) @IsInt() @Min(10) @Max(300) heartRate: number;
  @Type(() => Number) @IsInt() @Min(30) @Max(300) bpSystolic: number;
  @Type(() => Number) @IsInt() @Min(40) @Max(100) spO2: number;
  @Type(() => Number) @IsNumber() @Min(25) @Max(45) tempCelsius: number;
  @Type(() => Number) @IsInt() @Min(2) @Max(80) respiratoryRate: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number;
  @IsIn(CONSCIOUSNESS) consciousness: (typeof CONSCIOUSNESS)[number];
  @IsBoolean() onSupplementalO2: boolean;
  @IsOptional() @IsBoolean() spo2Scale2?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  symptoms?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(1500)
  glucoseMgDl?: number;
  /** Urgency 1 (most urgent) – 5. Defaults to the score-based ESI suggestion. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) priority?: number;
}

export class LabResultDto {
  @Matches(patientIdRule) patientId: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) testName: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) value: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30) unit: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  referenceRange?: string;
}

export class ImagingUploadDto {
  @Matches(patientIdRule) patientId: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  impression?: string;
}

export class AppointmentDto {
  @Matches(patientIdRule) patientId: string;
  /** Book against a real doctor account (checks their working hours and availability). */
  @IsOptional() @IsString() @MaxLength(64) doctorId?: string;
  /** Free-text name; required only when no `doctorId` is given. */
  @ValidateIf((o) => !o.doctorId)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  doctorName?: string;
  /** Defaults to the doctor's department/specialty when a `doctorId` is given. */
  @ValidateIf((o) => !o.doctorId)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  department?: string;
  @IsISO8601() dateTime: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(500) reason: string;
}

export class WeeklyHoursDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkingWindowDto)
  windows: WorkingWindowDto[];
}

export class WorkingWindowDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(240) slotMinutes: number;
}

export class SetAvailabilityDto {
  @IsBoolean() isAvailable: boolean;
}

export class TaskDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) title: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) assignedTo: string;
  @IsOptional() @Matches(patientIdRule) patientId?: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?:
    'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export class PharmacyAuditDto {
  @Matches(patientIdRule) patientId: string;
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  medications: string[];
}

export class PatientQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'WAITING', 'FINISHED', 'NO_VISIT'])
  stage?: 'ALL' | 'ACTIVE' | 'WAITING' | 'FINISHED' | 'NO_VISIT';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
