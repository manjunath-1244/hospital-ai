import { mayRead } from './section-access';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { PatientDirectoryService } from './patient-directory.service';
import { SpecialistService } from './specialists/specialist.service';
import { OverviewService } from './overview.service';
import { VisitsService } from './visits/visits.service';
import { toVisitSummary } from './visits/visit-summary';
import { VISIT_STATUSES, type VisitStatus } from './visits/visit-status';
import { OrthancClient } from '../ai/dicom/orthanc.client';
import {
  AppointmentDto,
  ConsultationDto,
  ImagingUploadDto,
  LabResultDto,
  PatientQueryDto,
  PharmacyAuditDto,
  RegistrationDto,
  StartVisitDto,
  TaskDto,
  SetAvailabilityDto,
  TriageDto,
  VisitTransitionDto,
  WeeklyHoursDto,
} from './dto/hospital.dto';
import { Roles, USER_ROLES, type UserRole } from '../security/roles.decorator';
import { AuthUser, CurrentUser } from '../security/auth-user';
import { PatientEntity } from '../database/entities/patient.entity';

import { ReferralService } from './referrals/referral.service';
import { ReferralRecommendationService } from './referrals/referral-recommendation.service';

/** Every signed-in staff role except SPECIALIST, who works only from their referral inbox (minimum necessary). */
const STAFF_ROLES: UserRole[] = USER_ROLES.filter((r) => r !== 'SPECIALIST');

/** Each role gets only the clinical parts it may read (see section-access.ts); the rest is emptied. */
function viewFor<T extends PatientEntity>(user: AuthUser, p: T): T {
  return {
    ...p,
    allergies: mayRead(user.role, 'allergies') ? p.allergies : [],
    currentMedications: mayRead(user.role, 'medications')
      ? p.currentMedications
      : [],
    conditions: mayRead(user.role, 'conditions') ? p.conditions : [],
  };
}

@Controller('hospital')
export class HospitalController {
  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly lifecycle: HospitalLifecycleService,
    private readonly orthanc: OrthancClient,
    private readonly summaries: PatientSummaryService,
    private readonly directory: PatientDirectoryService,
    private readonly overview: OverviewService,
    private readonly visits: VisitsService,
    private readonly specialists: SpecialistService,
    private readonly referralRecService: ReferralRecommendationService,
    private readonly referrals: ReferralService,
  ) {}

  /** A specialist may open a patient only through a referral that is theirs (minimum necessary). */
  private async assertPatientAccess(user: AuthUser, patientId: string) {
    if (
      user.role === 'SPECIALIST' &&
      !(await this.referrals.specialistCanSeePatient(user.userId, patientId))
    )
      throw new ForbiddenException(
        'This patient is not referred to you. Open the patient from your consultations inbox.',
      );
  }

  // --- Patients ---
  @Get('patients')
  @Roles(...STAFF_ROLES)
  async patients(@Query() q: PatientQueryDto, @CurrentUser() user: AuthUser) {
    const { items, total } = await this.directory.list(q);
    return { items: items.map((p) => viewFor(user, p)), total };
  }

  @Get('patients/:id')
  async patient(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.assertPatientAccess(user, id);
    const item = await this.directory.getOne(id);
    if (!item) await this.hospital.getPatientById(id); // throws the 404
    return viewFor(user, item!);
  }

  @Get('patients/:id/summary')
  async summary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.assertPatientAccess(user, id);
    return this.summaries.summary(id, user.role);
  }

  @Get('patients/:id/referral-recommendation')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  referralRecommendation(@Param('id') id: string) {
    return this.referralRecService.evaluatePatient(id);
  }

  // --- Visits (one episode of care; the status lives here, not on the patient) ---
  @Get('patients/:id/visits')
  async patientVisits(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.assertPatientAccess(user, id);
    await this.hospital.getPatientById(id);
    return (await this.visits.listForPatient(id)).map((v) => toVisitSummary(v));
  }

  @Post('patients/:id/visits')
  @Roles('RECEPTIONIST', 'NURSE', 'ADMIN')
  startVisit(
    @Param('id') id: string,
    @Body() dto: StartVisitDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lifecycle.startVisit(id, dto, user);
  }

  @Get('visits')
  @Roles(...STAFF_ROLES)
  async visitList(@Query('status') status?: string) {
    const wanted = (status ?? '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter((x): x is VisitStatus =>
        (VISIT_STATUSES as readonly string[]).includes(x),
      );
    const rows = await this.visits.listByStatus(
      wanted.length ? wanted : VISIT_STATUSES,
      200,
    );
    return rows.map((v) => toVisitSummary(v));
  }

  @Get('visits/:id')
  async visit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role === 'SPECIALIST')
      await this.assertPatientAccess(
        user,
        (await this.visits.get(id)).patientId,
      );
    return this.lifecycle.visitDetail(id, user);
  }

  @Post('visits/:id/transition')
  transition(
    @Param('id') id: string,
    @Body() dto: VisitTransitionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lifecycle.transitionVisit(id, dto, user);
  }

  // --- Specialists and availability ---
  @Get('specialists')
  specialistList(
    @Query('specialty') specialty?: string,
    @Query('available') available?: string,
  ) {
    return this.specialists.find({
      specialty,
      onlyAvailable: available === 'true',
    });
  }

  @Get('specialties')
  specialtyList() {
    return this.specialists.specialties();
  }

  @Get('specialists/:id/availability')
  async specialistAvailability(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const parse = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime()))
        throw new BadRequestException(`Invalid date: ${v}`);
      return d;
    };
    return {
      ...(await this.specialists.getAvailability(id, {
        from: parse(from),
        to: parse(to),
        limit: limit ? Math.min(Number(limit) || 50, 200) : undefined,
      })),
      weeklyHours: await this.specialists.weeklyHours(id),
    };
  }

  @Patch('specialists/:id/availability')
  @Roles('ADMIN', 'SPECIALIST')
  async setAvailable(
    @Param('id') id: string,
    @Body() dto: SetAvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role === 'SPECIALIST' && user.userId !== id)
      throw new ForbiddenException('You can only change your own availability');
    return this.specialists.setAvailable(id, dto.isAvailable);
  }

  @Put('specialists/:id/hours')
  @Roles('ADMIN')
  setHours(@Param('id') id: string, @Body() dto: WeeklyHoursDto) {
    return this.specialists.setWeeklyHours(id, dto.windows);
  }

  @Get('overview')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')
  overviewStats() {
    return this.overview.get();
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
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'SPECIALIST')
  appointments(@CurrentUser() user: AuthUser) {
    // A specialist sees only their own appointments.
    return this.hospital.getAppointments(
      user.role === 'SPECIALIST' ? { doctorId: user.userId } : {},
    );
  }

  @Post('appointments')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  book(@Body() b: AppointmentDto) {
    return this.lifecycle.bookAppointment(b);
  }

  @Get('tasks')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')
  tasks() {
    return this.hospital.getTasks();
  }

  @Post('tasks')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')
  createTask(@Body() b: TaskDto) {
    return this.lifecycle.createTask(b);
  }

  // --- Lifecycle ---
  @Post('lifecycle/register-op')
  @Roles('RECEPTIONIST', 'ADMIN')
  registerOp(@Body() dto: RegistrationDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.registerOutpatient(dto, user);
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
