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
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const patientIdRule = /^[A-Za-z0-9-]{2,32}$/;

export class RegistrationDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(130) age: number;
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
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) doctorName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) department: string;
  @IsISO8601() dateTime: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(500) reason: string;
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
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class ClosePatientDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}
