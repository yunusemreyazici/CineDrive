import React from 'react';
import { ProfileSection } from './ProfileSection';
import { SecuritySection } from './SecuritySection';
import { UserManagementSection } from './UserManagementSection';

/** Identity details and password controls belong to one account pane. */
export const AccountSection: React.FC = () => (
  <>
    <ProfileSection />
    <SecuritySection />
    <UserManagementSection />
  </>
);
