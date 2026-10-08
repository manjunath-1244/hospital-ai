import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * The REST API validates bodies with a global ValidationPipe; tool calls bypass it, so write tools run the same DTO
 * rules here. The model can never create a record the API itself would have rejected.
 */
export async function validateDto<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<T> {
  const instance = plainToInstance(cls, input, {
    enableImplicitConversion: false,
  });
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length) {
    const msg = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new BadRequestException(`Invalid input: ${msg}`);
  }
  return instance;
}
