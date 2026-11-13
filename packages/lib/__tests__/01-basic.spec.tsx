import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import '@testing-library/jest-dom';
import UbbEditor from '../src';

describe('UbbEditor basics', () => {
  it('renders root, textarea and preview pane', () => {
    render(<UbbEditor defaultValue={'[b]hi[/b]'} />);
    expect(document.querySelector('[data-component="react-ubb"]')).toBeInTheDocument();
    expect(document.querySelector('.react-ubb__textarea')).toBeInTheDocument();
    expect(document.querySelector('.react-ubb__preview strong')).toBeInTheDocument();
  });

  it('controlled: value + onChange(source, meta)', () => {
    const onChange = vi.fn();
    render(<UbbEditor value="abc" onChange={onChange} />);
    const ta = document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith('abcd', expect.objectContaining({ visibleLength: 4, sourceLength: 4 }));
  });

  it('readOnly: textarea readOnly and toolbar buttons disabled (AC-11)', () => {
    render(<UbbEditor value="abc" readOnly />);
    expect(document.querySelector('.react-ubb__textarea')).toHaveAttribute('readonly');
    expect((screen.getByRole('button', { name: '加粗' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('mode=preview hides textarea, renders full preview (AC-15 前半)', () => {
    render(<UbbEditor defaultValue={'[i]x[/i]'} mode="preview" />);
    expect(document.querySelector('.react-ubb__textarea')).toBeNull();
    expect(document.querySelector('.react-ubb__body em')).toBeInTheDocument();
  });

  it('ref API: getSource / getPlainText / validate / clear', () => {
    const ref = createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]ab[/b]'} />);
    expect(ref.current.getSource()).toBe('[b]ab[/b]');
    expect(ref.current.getPlainText()).toBe('ab');
    expect(ref.current.validate()).toBe(true);
    ref.current.clear();
    expect(ref.current.getSource()).toBe('');
  });

  it('validate() false when unclosed (AC-05)', () => {
    const ref = createRef<any>();
    render(<UbbEditor ref={ref} defaultValue={'[b]x'} />);
    expect(ref.current.validate()).toBe(false);
  });

  it('toolbar buttons expose aria-label / aria-pressed (NFR-05)', () => {
    render(<UbbEditor defaultValue="abc" />);
    const bold = screen.getByRole('button', { name: '加粗' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
  });

  it('selection state stays in sync after toolbar transform: aria-pressed reflects the wrap (review fix 1)', () => {
    render(<UbbEditor defaultValue="hello" />);
    const ta = document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(0, 5);
    fireEvent.select(ta);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta.value).toBe('[b]hello[/b]');
    expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clear-styles unwraps back without moving the caret (review fix 1)', () => {
    render(<UbbEditor defaultValue="hello" />);
    const ta = document.querySelector('.react-ubb__textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(0, 5);
    fireEvent.select(ta);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(ta.value).toBe('[b]hello[/b]');
    // no caret move between clicks — clear must derive from synced selection state
    fireEvent.click(screen.getByRole('button', { name: '清除样式' }));
    expect(ta.value).toBe('hello');
  });
});
