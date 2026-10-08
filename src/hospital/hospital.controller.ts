import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { HospitalService } from './hospital.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { HospitalLifecycleService } from './hospital-lifecycle.service';
import { PatientSummaryService } from './patient-summary.service';
import { OrthancClient } from '../ai/dicom/orthanc.client';
import {
  AppointmentDto,
  ClosePatientDto,
  ConsultationDto,
  ImagingUploadDto,
  LabResultDto,
  PatientQueryDto,
  PharmacyAuditDto,
  RegistrationDto,
  TaskDto,
  TriageDto,
} from './dto/hospital.dto';
import { Roles } from '../security/roles.decorator';
import { AuthUser, CurrentUser } from '../security/auth-user';
import { PatientEntity } from '../database/entities/patient.entity';

/** Receptionists see demographics and queue status only: no clinical history (minimum necessary). */
function viewFor(user: AuthUser, p: PatientEntity) {
  if (user.role === 'RECEPTIONIST')
    return { ...p, allergies: [], currentMedications: [], conditions: [] };
  return p;
}

@Controller('hospital')
export class HospitalController {
  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly lifecycle: HospitalLifecycleService,
    private readonly orthanc: OrthancClient,
    private readonly summaries: PatientSummaryService,
  ) {}

  // --- Patients ---
  @Get('patients')
  async patients(@Query() q: PatientQueryDto, @CurrentUser() user: AuthUser) {
    const { items, total } = await this.hospital.listPatients(q);
    return { items: items.map((p) => viewFor(user, p)), total };
  }

  @Get('patients/:id')
  async patient(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return viewFor(user, await this.hospital.getPatientById(id));
  }

  @Get('patients/:id/summary')
  summary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.summaries.summary(id, user.role);
  }

  @Post('patients/:id/close')
  @Roles('ADMIN', 'DOCTOR')
  close(
    @Param('id') id: string,
    @Body() dto: ClosePatientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lifecycle.closePatientSession(id, user, dto.reason);
  }

  @Post('patients/:id/reopen')
  @Roles('ADMIN', 'DOCTOR')
  reopen(@Param('id') id: string) {
    return this.lifecycle.reopenPatientSession(id);
  }

  @Delete('patients/:id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @Query('confirm') confirm?: string) {
    return this.lifecycle.deletePatient(id, confirm);
  }

  @Get('patients/:id/labs')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST')
  labs(@Param('id') id: string) {
    return this.hospital.getPatientLabs(id);
  }

  @Get('patients/:id/medications')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST')
  medications(@Param('id') id: string) {
    return this.hospital.getPatientMedications(id);
  }

  @Get('patients/:id/vitals')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  async vitals(@Param('id') id: string) {
    await this.hospital.getPatientById(id);
    return this.records.listVitals(id);
  }

  @Get('patients/:id/imaging')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST')
  async imaging(@Param('id') id: string) {
    await this.hospital.getPatientById(id);
    return (await this.records.listImagingStudies(id)).map((s) =>
      this.lifecycle.studyView(s),
    );
  }

  @Get('imaging/:studyId/preview')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST')
  async preview(@Param('studyId') studyId: string) {
    const study = await this.records.getImagingStudy(studyId);
    if (!study.orthancInstanceId)
      throw new BadRequestException('This study has no stored image');
    return new StreamableFile(
      await this.orthanc.getPreviewPng(study.orthancInstanceId),
      { type: 'image/png' },
    );
  }

  // --- Appointments & tasks ---
  @Get('appointments')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  appointments() {
    return this.hospital.getAppointments();
  }

  @Post('appointments')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  book(@Body() b: AppointmentDto) {
    return this.hospital.bookAppointment(
      b.patientId,
      b.doctorName,
      b.department,
      b.dateTime,
      b.reason,
    );
  }

  @Get('tasks')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')
  tasks() {
    return this.hospital.getTasks();
  }

  @Post('tasks')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')
  createTask(@Body() b: TaskDto) {
    return this.hospital.createTask(
      b.title,
      b.assignedTo,
      b.patientId,
      b.priority,
    );
  }

  // --- Lifecycle ---
  @Post('lifecycle/register-op')
  @Roles('RECEPTIONIST', 'ADMIN')
  registerOp(@Body() dto: RegistrationDto) {
    return this.lifecycle.registerOutpatient(dto);
  }

  @Get('lifecycle/queue')
  @Roles('RECEPTIONIST', 'DOCTOR', 'NURSE', 'ADMIN')
  queue() {
    return this.lifecycle.queue();
  }

  @Post('lifecycle/record-consultation')
  @Roles('DOCTOR', 'ADMIN')
  consultation(@Body() dto: ConsultationDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.recordDoctorConsultation(dto, user);
  }

  @Post('lifecycle/lab-result')
  @Roles('RADIOLOGIST', 'DOCTOR', 'NURSE', 'ADMIN')
  lab(@Body() dto: LabResultDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.recordLabResult(dto, user);
  }

  @Post('lifecycle/imaging-study')
  @Roles('RADIOLOGIST', 'ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  imagingStudy(
    @Body() dto: ImagingUploadDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file)
      throw new BadRequestException(
        'A DICOM file is required in form field "file"',
      );
    return this.lifecycle.recordImagingStudy(dto, file.buffer, user);
  }

  @Post('lifecycle/triage')
  @Roles('NURSE', 'DOCTOR', 'ADMIN')
  triage(@Body() dto: TriageDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.recordTriageAndVitals(dto, user);
  }

  @Get('lifecycle/ward')
  @Roles('NURSE', 'DOCTOR', 'ADMIN')
  ward() {
    return this.lifecycle.wardBoard();
  }

  @Get('lifecycle/unconsulted-alerts')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  unconsulted() {
    return this.lifecycle.checkUnconsultedPatientAlerts();
  }

  // --- Pharmacy ---
  @Post('pharmacy/audit')
  @Roles('PHARMACIST', 'DOCTOR', 'ADMIN')
  pharmacyAudit(@Body() dto: PharmacyAuditDto) {
    return this.lifecycle.pharmacyAudit(dto.patientId, dto.medications);
  }

  @Get('pharmacy/queue')
  @Roles('PHARMACIST', 'ADMIN')
  pharmacyQueue() {
    return this.lifecycle.pharmacyQueue();
  }
}
