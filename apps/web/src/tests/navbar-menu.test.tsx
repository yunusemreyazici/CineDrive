import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Navbar } from '../components/layout/Navbar';
import { t } from '../i18n';
import {
  createTestQueryClient,
  renderWithProviders,
  seedSession,
} from './helpers/renderWithProviders';

describe('Navbar user menu', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    seedSession(queryClient);
    renderWithProviders(<Navbar />, { queryClient });
  });

  const getTrigger = () => screen.getByRole('button', { name: t.nav.userMenu });

  it('reports its expanded state', () => {
    const trigger = getTrigger();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: t.nav.userMenu })).toBeInTheDocument();
  });

  it('closes when the user clicks elsewhere', () => {
    fireEvent.click(getTrigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = getTrigger();
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes its items as menu items', () => {
    fireEvent.click(getTrigger());

    expect(screen.getByRole('menuitem', { name: t.nav.settings })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: t.nav.signOut })).toBeInTheDocument();
  });
});
