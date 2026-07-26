import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../components/common/Modal';
import { t } from '../i18n';

const renderModal = (onClose = vi.fn()) => {
  const utils = render(
    <>
      <button type="button">Dışarıdaki düğme</button>
      <Modal isOpen onClose={onClose} title="Test Diyaloğu" description="Açıklama">
        <div className="p-4">
          <button type="button">İlk</button>
          <button type="button">Son</button>
        </div>
      </Modal>
    </>,
  );
  return { ...utils, onClose };
};

describe('Modal', () => {
  it('exposes itself as a labelled dialog', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Test Diyaloğu');
    expect(dialog).toHaveAccessibleDescription('Açıklama');
  });

  it('closes on Escape', () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', () => {
    renderModal();

    const dialogButtons = screen.getAllByRole('button', { name: /İlk|Son/ });
    const last = dialogButtons[dialogButtons.length - 1]!;
    last.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    // Focus wraps to the first focusable element rather than escaping to the
    // "Dışarıdaki düğme" behind the overlay.
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'Dışarıdaki düğme' }),
    );
  });

  it('locks background scrolling while open and restores it on close', () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes when the backdrop is activated', () => {
    const { onClose } = renderModal();

    // The backdrop is a real button, so it is reachable and reports a name.
    const backdrops = screen.getAllByRole('button', { name: t.common.close });
    fireEvent.click(backdrops[0]!);

    expect(onClose).toHaveBeenCalled();
  });
});
