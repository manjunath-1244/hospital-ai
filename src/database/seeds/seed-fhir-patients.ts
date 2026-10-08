import axios from 'axios';

const FHIR_URL = process.env.FHIR_SERVER_URL || 'http://localhost:8080/fhir';

const FIRST_NAMES = [
  'James',
  'Mary',
  'John',
  'Patricia',
  'Robert',
  'Jennifer',
  'Michael',
  'Linda',
  'William',
  'Elizabeth',
  'David',
  'Barbara',
  'Richard',
  'Susan',
  'Joseph',
  'Jessica',
  'Thomas',
  'Sarah',
  'Charles',
  'Karen',
];
const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
];
const GENDERS = ['male', 'female'];

async function seedFhirPatients(totalPatients = 50) {
  console.log(
    `🚀 Starting FHIR Patient Bulk Seeding (${totalPatients} patients) to ${FHIR_URL}...`,
  );
  let createdCount = 0;

  for (let i = 1; i <= totalPatients; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const gender = GENDERS[i % 2];
    const birthYear = 1950 + (i % 50);
    const month = String((i % 12) + 1).padStart(2, '0');
    const day = String((i % 28) + 1).padStart(2, '0');
    const patientId = `patient-bulk-${100 + i}`;

    const fhirPatient = {
      resourceType: 'Patient',
      id: patientId,
      identifier: [
        {
          system: 'http://hospital.org/patient-ids',
          value: `P${2000 + i}`,
        },
      ],
      name: [
        {
          use: 'official',
          family: lastName,
          given: [firstName],
          text: `${firstName} ${lastName}`,
        },
      ],
      gender,
      birthDate: `${birthYear}-${month}-${day}`,
      telecom: [
        {
          system: 'phone',
          value: `+1-555-${String(1000 + i).padStart(4, '0')}`,
        },
      ],
    };

    try {
      await axios.put(`${FHIR_URL}/Patient/${patientId}`, fhirPatient, {
        headers: { 'Content-Type': 'application/fhir+json' },
      });
      createdCount++;
      if (i % 10 === 0) {
        console.log(
          `  ✅ Successfully seeded ${i}/${totalPatients} FHIR Patients...`,
        );
      }
    } catch (err: any) {
      console.warn(
        `  ⚠️ Failed to seed FHIR Patient ${patientId}: ${err.message}`,
      );
    }
  }

  console.log(`--------------------------------------------------`);
  console.log(
    `🎉 BULK SEEDING COMPLETE: ${createdCount} FHIR Patients created!`,
  );
  console.log(`View patients in browser: ${FHIR_URL}/Patient?_count=100`);
  console.log(`--------------------------------------------------`);
}

seedFhirPatients(50).catch((err) => console.error(err));
