import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PhaseIllustration } from './PhaseIllustration';

describe('PhaseIllustration', () => {
  const knownTitles = [
    'Take off & Hover',
    'Final Hover',
    'Roll Snaps',
    'Pitch Snaps',
    'Yaw Snaps',
    'Throttle Sweep',
    'Land',
  ];

  it.each(knownTitles)('renders SVG for "%s"', (title) => {
    const { container } = render(<PhaseIllustration title={title} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders nothing for unknown title', () => {
    const { container } = render(<PhaseIllustration title="Unknown Phase" />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(container.querySelector('.flight-guide-phase-illustration')).not.toBeInTheDocument();
  });

  it('applies aria-hidden to SVGs', () => {
    const { container } = render(<PhaseIllustration title="Roll Snaps" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses custom size', () => {
    const { container } = render(<PhaseIllustration title="Land" size={64} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveAttribute('height', '64');
  });

  it('wraps SVG in .flight-guide-phase-illustration span', () => {
    const { container } = render(<PhaseIllustration title="Hover" />);
    const wrapper = container.querySelector('.flight-guide-phase-illustration');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.tagName).toBe('SPAN');
  });
});
