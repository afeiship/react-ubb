/**
 * 基础渲染测试
 * 验证 ReactUbb 组件的基本渲染行为，包括：
 * - 默认 className 是否正确应用
 * - 自定义 className 是否能正确合并
 * - children 内容是否正常渲染
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReactUbb from '../src';

describe('ReactUbb', () => {
  it('should render with default className', () => {
    render(<ReactUbb>hello</ReactUbb>);
    const el = screen.getByText('hello');
    expect(el).toBeInTheDocument();
    expect(el.closest('[data-component="react-ubb"]')).toBeInTheDocument();
  });

  it('should merge custom className', () => {
    const { container } = render(<ReactUbb className="custom-class">test</ReactUbb>);
    expect(container.firstChild).toHaveClass('react-ubb', 'custom-class');
  });

  it('should render children', () => {
    render(<ReactUbb>child content</ReactUbb>);
    expect(screen.getByText('child content')).toBeInTheDocument();
  });
});
