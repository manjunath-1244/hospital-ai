import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChatDto {
  @IsString() @MinLength(1) @MaxLength(4000) message: string;
  /** Continue an existing conversation. The server holds the history (memory); clients no longer send it. */
  @IsOptional() @Matches(/^[A-Za-z0-9-]{8,64}$/) threadId?: string;
}

export const DOCUMENT_TYPES = [
  'SBAR',
  'PRIOR_AUTH',
  'DISCHARGE_TRANSLATION',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export class DocumentDto {
  @IsIn(DOCUMENT_TYPES) type: DocumentType;
  @Matches(/^[A-Za-z0-9-]{2,32}$/) patientId: string;
  @IsOptional() @IsString() @MaxLength(60) language?: string;
  @IsOptional() @IsString() @MaxLength(300) procedure?: string;
}
