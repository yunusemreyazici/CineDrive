import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { version } from '../../package.json';
import { AboutSection } from '../pages/settings/sections/AboutSection';

afterEach(cleanup);

it('shows the full web package version instead of a fixed release label', () => {
  render(<AboutSection />);
  expect(screen.getByText(`v${version}`, { exact: true })).toBeInTheDocument();
});
