'use client';

import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { HeaderNav } from '../components/layout/HeaderNav';
import { LoginScreen } from '../components/auth/LoginScreen';
import { MastraChatDrawer } from '../components/ai/MastraChatDrawer';
import { ReceptionistPortal } from '../components/portals/ReceptionistPortal';
import { DoctorWorkbenchPortal } from '../components/portals/DoctorWorkbenchPortal';
import { EdTriagePortal } from '../components/portals/EdTriagePortal';
import { NurseWardPortal } from '../components/portals/NurseWardPortal';
import { RadiologyPortal } from '../components/portals/RadiologyPortal';
import { PharmacyPortal } from '../components/portals/PharmacyPortal';
import { CareCoordinatorPortal } from '../components/portals/CareCoordinatorPortal';
import { AdminPortal } from '../components/portals/AdminPortal';

export default function Home() {
  const { user, ready } = useAuth();
  const { role } = useRole();

  if (!ready) return <div className="min-h-screen bg-[#0a0f1c]" />;
  if (!user) return <LoginScreen />;

  const renderActivePortal = () => {
    switch (role) {
      case 'RECEPTIONIST':
        return <ReceptionistPortal />;
      case 'ED_NURSE':
        return (
          <div className="space-y-10">
            <EdTriagePortal />
            <NurseWardPortal />
          </div>
        );
      case 'DOCTOR':
        return <DoctorWorkbenchPortal />;
      case 'RADIOLOGIST':
        return <RadiologyPortal />;
      case 'PHARMACIST':
        return <PharmacyPortal />;
      case 'CARE_COORDINATOR':
        return <CareCoordinatorPortal />;
      case 'ADMIN':
        return <AdminPortal />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1c] text-slate-100">
      <HeaderNav />
      <a href="#main" className="skip-link">Skip to content</a>
      <main id="main" className="flex-1 mx-auto max-w-[96rem] w-full px-6 py-8 lg:px-8 space-y-8">
        {renderActivePortal()}
      </main>
      <MastraChatDrawer />
    </div>
  );
}
