/** Specialists, availability and booking against a real doctor account. Run: `npm run test:workflow`. */
import { call, check, finish, login } from './client.mjs';

async function main() {
  await login('receptionist', 'doctor', 'admin', 'cardiologist', 'neurologist');
  const stamp = Date.now().toString().slice(-6);

  console.log('\n▶ Specialist accounts');
  const list = await call('doctor', 'GET', '/hospital/specialists');
  const cardio = list.body.find?.((s) => s.specialty === 'Cardiology');
  const neuro = list.body.find?.((s) => s.specialty === 'Neurology');
  check('cardiology and neurology specialists exist', !!cardio && !!neuro, JSON.stringify(list.body).slice(0, 200));
  check('filter by specialty works', (await call('doctor', 'GET', '/hospital/specialists?specialty=neurology')).body.length === 1);
  check('specialties are listed from the data', (await call('doctor', 'GET', '/hospital/specialties')).body.includes('Cardiology'));
  const me = await call('cardiologist', 'GET', '/auth/me');
  check('specialist can sign in and sees their specialty', me.body.role === 'SPECIALIST' && me.body.specialty === 'Cardiology', JSON.stringify(me.body));

  console.log('\n▶ Availability');
  const av = await call('doctor', 'GET', `/hospital/specialists/${cardio.id}/availability?limit=5`);
  check('free slots are returned, earliest first', av.body.slots?.length === 5 && av.body.slots[0] < av.body.slots[1], JSON.stringify(av.body).slice(0, 200));
  const slot = av.body.slots[0];

  console.log('\n▶ Booking against a doctor account');
  const reg = await call('receptionist', 'POST', '/hospital/lifecycle/register-op', {
    name: `Slot Test ${stamp}`, age: 50, gender: 'male', phone: `+1 555 ${stamp.slice(0, 3)} ${stamp.slice(3)}1`, bloodType: 'A+', chiefComplaint: 'palpitations',
  });
  const pid = reg.body.patientId;
  const off = await call('receptionist', 'POST', '/hospital/appointments', { patientId: pid, doctorId: cardio.id, dateTime: new Date(Date.parse(slot) + 7 * 60_000).toISOString(), reason: 'check' });
  check('a time that is not one of the doctor\'s slots is refused (409)', off.status === 409, String(off.status));
  const ok = await call('receptionist', 'POST', '/hospital/appointments', { patientId: pid, doctorId: cardio.id, dateTime: slot, reason: 'palpitations review' });
  check('booking an offered slot works and fills in name and department', ok.status === 201 && ok.body.doctorName?.includes('Wilson') && ok.body.department === 'Cardiology', JSON.stringify(ok.body).slice(0, 200));
  const again = await call('receptionist', 'POST', '/hospital/appointments', { patientId: pid, doctorId: cardio.id, dateTime: slot, reason: 'duplicate' });
  check('the same slot cannot be booked twice (409)', again.status === 409, String(again.status));
  const av2 = await call('doctor', 'GET', `/hospital/specialists/${cardio.id}/availability?limit=5`);
  check('the booked slot disappears from availability', !av2.body.slots.includes(slot));

  console.log('\n▶ Unavailable specialist');
  const off1 = await call('cardiologist', 'PATCH', `/hospital/specialists/${cardio.id}/availability`, { isAvailable: false });
  check('a specialist can mark themselves unavailable', off1.body.isAvailable === false, JSON.stringify(off1.body));
  const other = await call('neurologist', 'PATCH', `/hospital/specialists/${cardio.id}/availability`, { isAvailable: true });
  check('a specialist cannot change someone else (403)', other.status === 403, String(other.status));
  const none = await call('doctor', 'GET', `/hospital/specialists/${cardio.id}/availability`);
  check('no slots are offered while unavailable', none.body.slots?.length === 0);
  await call('admin', 'PATCH', `/hospital/specialists/${cardio.id}/availability`, { isAvailable: true });

  console.log('\n▶ Cleanup');
  const del = await call('admin', 'DELETE', `/hospital/patients/${pid}?confirm=${pid}`);
  check('test patient deleted', del.body.success === true, JSON.stringify(del.body).slice(0, 150));
}

finish(main);
