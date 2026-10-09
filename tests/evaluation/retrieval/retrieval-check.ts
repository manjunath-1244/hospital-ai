import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { HospitalLifecycleService } from '../../../src/hospital/hospital-lifecycle.service';
import { VectorRagService } from '../../../src/ai/rag/vector-rag.service';
import * as fs from 'fs';
import { OrthancClient } from '../../../src/ai/dicom/orthanc.client';
import type { AuthUser } from '../../../src/security/auth-user';

/**
 * Does the agent's knowledge stay in sync with what users enter, and does retrieval return the RIGHT data?
 * Creates a throw-away patient through the real workflows, checks it is searchable immediately, measures retrieval
 * on known facts (patients and policies), then deletes the patient again.
 */
const doctor: AuthUser = {
  userId: 'USR-EVAL-DOCTOR',
  userName: 'Dr. Sarah Jenkins',
  role: 'DOCTOR',
};
const admin: AuthUser = {
  userId: 'USR-EVAL-ADMIN',
  userName: 'Admin',
  role: 'ADMIN',
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const flow = app.get(HospitalLifecycleService);
  const rag = app.get(VectorRagService);
  const ds = app.get(DataSource);
  let ok = 0,
    total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    console.log(
      `  ${pass ? '✅' : '❌'} ${name}${pass ? '' : `  → ${detail}`}`,
    );
  };
  const sources = async (pid: string) =>
    (
      await ds.query(
        `select distinct source from document_embeddings where patient_id=$1`,
        [pid],
      )
    ).map((r: any) => r.source as string);

  console.log('\n▶ New data becomes searchable immediately');
  const reg = await flow.registerOutpatient(
    {
      name: 'Zed Verify',
      age: 52,
      gender: 'male',
      phone: '+1 555 010 2020',
      bloodType: 'A+',
      chiefComplaint: 'recurrent kidney stones with severe flank pain',
    } as any,
    doctor,
  );
  const pid = reg.patientId;
  check('registration is indexed (ragIndexed flag)', reg.ragIndexed === true);
  check(
    'chart summary document exists in the index',
    (await sources(pid)).includes(`patient-${pid}`),
  );
  await flow.recordDoctorConsultation(
    {
      patientId: pid,
      diagnosis: 'Nephrolithiasis',
      prescriptions: ['Tamsulosin 0.4mg daily'],
      notes: 'CT shows 6mm left ureteric stone, hydration advised',
    } as any,
    doctor,
  );
  await flow.recordLabResult(
    {
      patientId: pid,
      testName: 'Creatinine',
      value: '1.1',
      unit: 'mg/dL',
      referenceRange: '0.6 - 1.1',
    } as any,
    doctor,
  );
  await flow.recordTriageAndVitals(
    {
      patientId: pid,
      heartRate: 96,
      bpSystolic: 138,
      spO2: 97,
      tempCelsius: 37.2,
      respiratoryRate: 18,
      consciousness: 'ALERT',
      onSupplementalO2: false,
      painScore: 8,
    } as any,
    doctor,
  );
  const src = await sources(pid);
  check(
    'consultation indexed',
    src.some((s) => s.startsWith('consultation-')),
  );
  check(
    'lab result indexed',
    src.some((s) => s.startsWith('lab-')),
  );
  check(
    'vitals indexed',
    src.some((s) => s.startsWith('vitals-')),
  );

  console.log('\n▶ Patient-data retrieval returns the right patient/fact');
  const top = async (q: string, p?: string) =>
    rag.searchPatientRecords(q, p, 3);
  const a = await top('what is the diagnosis', pid);
  check(
    'scoped: diagnosis question -> consultation with Nephrolithiasis is in the top 3',
    a.some((h) => /Nephrolithiasis/.test(h.content)),
    JSON.stringify(a.map((h) => h.heading)),
  );
  const b = await top('which patient has kidney stones and flank pain');
  check(
    'cross-patient: kidney stones -> the new patient',
    b.some((h) => h.patientId === pid),
    JSON.stringify(b.map((h) => h.patientId)),
  );
  const c = await top('who is taking tamsulosin');
  check(
    'cross-patient: tamsulosin -> the new patient',
    c[0]?.patientId === pid,
    JSON.stringify(c.map((h) => h.patientId)),
  );
  const d = await top('type 2 diabetes metformin lisinopril');
  check(
    'cross-patient: diabetes/metformin -> P1001',
    d.some((h) => h.patientId === 'P1001'),
    JSON.stringify(d.map((h) => h.patientId)),
  );
  const e = await top('coronary artery disease atorvastatin');
  check(
    'cross-patient: coronary artery disease -> P1002',
    e.some((h) => h.patientId === 'P1002'),
    JSON.stringify(e.map((h) => h.patientId)),
  );
  const f = await top('creatinine result', pid);
  check(
    'scoped: creatinine question -> the lab record',
    /Creatinine/i.test(f[0]?.content ?? ''),
    JSON.stringify(f.map((h) => h.heading)),
  );

  console.log(
    '\n▶ Policy retrieval (questions are paraphrased, not copied from the text)',
  );
  const policy: Array<[string, string, string]> = [
    [
      'how many hours must vitals be stable before a patient can be discharged',
      'discharge-policy.md',
      '12 consecutive hours',
    ],
    [
      'what glucose level triggers a critical red alert',
      'emergency-escalation.md',
      '250',
    ],
    [
      'what do we do if a patient gets a rash after a drug',
      'medication-administration-guidelines.md',
      'Adverse Drug Reaction',
    ],
    [
      'how far in advance must routine follow up visits be booked',
      'appointment-policy.md',
      '48 hours',
    ],
    [
      'double check requirement for insulin and heparin',
      'medication-administration-guidelines.md',
      'Double-Check',
    ],
    [
      'which antibiotics can be used if the patient is allergic to penicillin',
      'discharge-policy.md',
      'non-beta-lactam',
    ],
    [
      'who must sign off before an emergency patient is released',
      'emergency-escalation.md',
      'sign-off',
    ],
    [
      'urgent consultation request who handles it',
      'appointment-policy.md',
      'Triage Nurse',
    ],
    // Not tuned for: further paraphrases across policy / SOP / guideline documents (same production search path)
    [
      'who needs to clear a cancellation made the day before the visit',
      'appointment-policy.md',
      'supervisory',
    ],
    [
      'how long can an emergent level 2 patient wait for a physician',
      'emergency-triage-protocol.md',
      '10 minutes',
    ],
    [
      'signs of a stroke that should trigger a neurology referral',
      'neurology-referral-guidelines.md',
      'facial',
    ],
    [
      'can one nurse alone give insulin',
      'medication-administration-guidelines.md',
      'Double-Check',
    ],
    [
      'what happens to the antibiotic choice at discharge when the patient has a beta-lactam allergy',
      'discharge-and-followup-policy.md',
      'Beta-Lactam',
    ],
  ];
  for (const [q, file, fact] of policy) {
    const hits = await rag.searchPolicies(q, 3);
    check(
      `"${q}"`,
      hits.some((h) => h.source === file && h.content.includes(fact)),
      JSON.stringify(hits.map((h) => `${h.source}#${h.heading.slice(0, 25)}`)),
    );
  }

  console.log(
    '\n▶ Cleanup removes everything the agent knew about the patient',
  );
  await flow.deletePatient(pid, pid);
  check(
    'index has no chunks left for the deleted patient',
    (await sources(pid)).length === 0,
  );
  const g = await top('kidney stones flank pain');
  check(
    'deleted patient no longer retrievable',
    !g.some((h) => h.patientId === pid),
  );

  console.log(
    '\n▶ Deleting one patient must not remove an image another patient still uses',
  );
  const dcm =
    process.env.DICOM_SAMPLE_PATH ??
    '/home/bitcot/Documents/Medical standards/poc/bbmri-53323851.dcm';
  if (fs.existsSync(dcm)) {
    const orthanc = app.get(OrthancClient);
    const mk = async (name: string) =>
      (
        await flow.registerOutpatient(
          {
            name,
            age: 30,
            gender: 'male',
            phone: '+1 555 010 3030',
            allowDuplicate: true,
            bloodType: 'O+',
          } as any,
          doctor,
        )
      ).patientId as string;
    const [a1, b1] = [await mk('Share Alpha'), await mk('Share Beta')];
    const buf = fs.readFileSync(dcm);
    const sa: any = await flow.recordImagingStudy(
      { patientId: a1 } as any,
      buf,
      doctor,
    );
    const sb: any = await flow.recordImagingStudy(
      { patientId: b1 } as any,
      buf,
      doctor,
    );
    const rows = await ds.query(
      `select "orthancInstanceId" as id from imaging_studies where "patientId" in ($1,$2)`,
      [a1, b1],
    );
    check(
      'both studies point at the same stored PACS instance (identical file)',
      rows.length === 2 && rows[0].id === rows[1].id && !!rows[0].id,
    );
    await flow.deletePatient(a1, a1);
    let stillThere = true;
    try {
      await orthanc.getPreviewPng(rows[0].id);
    } catch {
      stillThere = false;
    }
    check(
      'image still exists in the PACS after deleting the first patient',
      stillThere,
    );
    await flow.deletePatient(b1, b1);
    const realUser = await ds.query(
      `select 1 from imaging_studies where "orthancInstanceId" = $1 limit 1`,
      [rows[0].id],
    );
    let present = true;
    try {
      await orthanc.getPreviewPng(rows[0].id);
    } catch {
      present = false;
    }
    check(
      realUser.length
        ? 'image is kept because a real study still uses it'
        : 'image is removed from the PACS once the last patient using it is deleted',
      realUser.length ? present : !present,
    );
    // Leave the PACS as we found it for any real patient that shares this exact file.
    const real = await ds.query(
      `select 1 from imaging_studies where "orthancInstanceId" = $1 limit 1`,
      [rows[0].id],
    );
    if (real.length) await orthanc.uploadInstance(buf);
    void sa;
    void sb;
  } else {
    console.log('  (skipped: no sample DICOM file)');
  }

  console.log(`\n📊 ${ok}/${total} checks passed`);
  await app.close();
  process.exit(ok === total ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
