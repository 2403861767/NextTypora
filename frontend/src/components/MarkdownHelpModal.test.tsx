import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownHelpModal } from './MarkdownHelpModal';

describe('MarkdownHelpModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Markdown guide with core examples when open', () => {
    render(<MarkdownHelpModal open onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Markdown 使用指南' })).toBeInTheDocument();
    expect(screen.getByText(/# 一级标题/)).toBeInTheDocument();
    expect(screen.getByText(/```mermaid/)).toBeInTheDocument();
    expect(screen.getByText(/\[TOC\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[\^1\]: 脚注说明/)).toBeInTheDocument();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    render(<MarkdownHelpModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭 Markdown 帮助' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<MarkdownHelpModal open onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const { container } = render(<MarkdownHelpModal open={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
