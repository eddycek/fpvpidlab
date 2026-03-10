import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresetSelector } from './PresetSelector';

// Mock PRESET_PROFILES constant
vi.mock('@shared/constants', () => ({
  PRESET_PROFILES: {
    'tiny-whoop': {
      id: 'tiny-whoop',
      name: 'Tiny Whoop',
      description: 'Indoor FPV drone',
      size: '1"',
      battery: '1S',
      propSize: '31mm',
      weight: 25,
      motorKV: 19000,
    },
    '5inch-freestyle': {
      id: '5inch-freestyle',
      name: '5" Freestyle',
      description: 'Versatile 5-inch quad',
      size: '5"',
      battery: '4S',
      propSize: '5.1"',
      weight: 650,
      motorKV: 2400,
    },
    '7inch-longrange': {
      id: '7inch-longrange',
      name: '7" Long Range',
      description: 'Long range cruiser',
      size: '7"',
      battery: '6S',
      propSize: '7"',
      weight: 850,
      motorKV: 1750,
    },
  },
}));

describe('PresetSelector', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders preset list', () => {
    render(<PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />);

    expect(screen.getByText('Tiny Whoop')).toBeInTheDocument();
    expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    expect(screen.getByText('7" Long Range')).toBeInTheDocument();
  });

  it('renders preset descriptions', () => {
    render(<PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />);

    expect(screen.getByText('Indoor FPV drone')).toBeInTheDocument();
    expect(screen.getByText('Versatile 5-inch quad')).toBeInTheDocument();
    expect(screen.getByText('Long range cruiser')).toBeInTheDocument();
  });

  it('renders preset specifications', () => {
    render(<PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />);

    // Check for Tiny Whoop specs
    expect(screen.getByText('1"')).toBeInTheDocument();
    expect(screen.getByText('1S')).toBeInTheDocument();
    expect(screen.getByText('31mm')).toBeInTheDocument();
    expect(screen.getByText('25g')).toBeInTheDocument();
    expect(screen.getByText('19000KV')).toBeInTheDocument();
  });

  it('calls onSelect when a preset is clicked', async () => {
    const user = userEvent.setup();
    render(<PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />);

    const tinyWhoopCard = screen.getByText('Tiny Whoop').closest('.preset-card');
    await user.click(tinyWhoopCard!);

    expect(mockOnSelect).toHaveBeenCalledWith('tiny-whoop');
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect with correct preset ID when different preset is clicked', async () => {
    const user = userEvent.setup();
    render(<PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />);

    const freestyleCard = screen.getByText('5" Freestyle').closest('.preset-card');
    await user.click(freestyleCard!);

    expect(mockOnSelect).toHaveBeenCalledWith('5inch-freestyle');
  });

  it('applies "selected" CSS class to selected preset', () => {
    const { container: _container } = render(
      <PresetSelector selectedPresetId="tiny-whoop" onSelect={mockOnSelect} />
    );

    const tinyWhoopCard = screen.getByText('Tiny Whoop').closest('.preset-card');
    expect(tinyWhoopCard).toHaveClass('selected');
  });

  it('does not apply "selected" class to unselected presets', () => {
    const { container: _container } = render(
      <PresetSelector selectedPresetId="tiny-whoop" onSelect={mockOnSelect} />
    );

    const freestyleCard = screen.getByText('5" Freestyle').closest('.preset-card');
    expect(freestyleCard).not.toHaveClass('selected');
  });

  it('shows radio indicator dot for selected preset', () => {
    const { container: _container } = render(
      <PresetSelector selectedPresetId="5inch-freestyle" onSelect={mockOnSelect} />
    );

    const freestyleCard = screen.getByText('5" Freestyle').closest('.preset-card');
    const radioDot = freestyleCard?.querySelector('.preset-card-radio-dot');
    expect(radioDot).toBeInTheDocument();
  });

  it('does not show radio indicator dot for unselected presets', () => {
    const { container: _container } = render(
      <PresetSelector selectedPresetId="tiny-whoop" onSelect={mockOnSelect} />
    );

    const freestyleCard = screen.getByText('5" Freestyle').closest('.preset-card');
    const radioDot = freestyleCard?.querySelector('.preset-card-radio-dot');
    expect(radioDot).not.toBeInTheDocument();
  });

  it('renders all presets in a grid', () => {
    const { container } = render(
      <PresetSelector selectedPresetId={null} onSelect={mockOnSelect} />
    );

    const grid = container.querySelector('.preset-grid');
    expect(grid).toBeInTheDocument();
    expect(grid?.children.length).toBe(3); // 3 mocked presets
  });

  it('allows selecting a different preset', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PresetSelector selectedPresetId="tiny-whoop" onSelect={mockOnSelect} />
    );

    // Initially Tiny Whoop is selected
    expect(screen.getByText('Tiny Whoop').closest('.preset-card')).toHaveClass('selected');

    // Click on 7" Long Range
    const longRangeCard = screen.getByText('7" Long Range').closest('.preset-card');
    await user.click(longRangeCard!);

    expect(mockOnSelect).toHaveBeenCalledWith('7inch-longrange');

    // Simulate parent updating selectedPresetId
    rerender(<PresetSelector selectedPresetId="7inch-longrange" onSelect={mockOnSelect} />);

    expect(screen.getByText('7" Long Range').closest('.preset-card')).toHaveClass('selected');
    expect(screen.getByText('Tiny Whoop').closest('.preset-card')).not.toHaveClass('selected');
  });
});
