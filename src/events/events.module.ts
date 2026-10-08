import { Module } from '@nestjs/common';
import { HospitalEventsGateway } from './hospital-events.gateway';

@Module({
  providers: [HospitalEventsGateway],
  exports: [HospitalEventsGateway],
})
export class EventsModule {}
