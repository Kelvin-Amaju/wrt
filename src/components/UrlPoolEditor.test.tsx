import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UrlPoolEditor } from './UrlPoolEditor';

describe('UrlPoolEditor', () => {
  it('shows live valid duplicate and invalid counts from one multiline field', () => {
    const onChange = vi.fn();
    render(<UrlPoolEditor value={'example.com\nhttps://EXAMPLE.com/\nfile:///tmp/a'} onChange={onChange} disabled={false} />);
    expect(screen.getByLabelText('Target URL Pool')).toBeInTheDocument();
    expect(screen.getByText(/Valid URLs: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Duplicates removed: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Invalid: 1/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'a.example\nb.example' } });
    expect(onChange).toHaveBeenCalledWith('a.example\nb.example');
  });
});
