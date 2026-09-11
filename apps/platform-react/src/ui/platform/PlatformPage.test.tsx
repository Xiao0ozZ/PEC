import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlatformPage } from './PlatformPage';

describe('PlatformPage', () => {
  it('renders orientation, supporting copy and page content', () => {
    render(
      <PlatformPage
        eyebrow="PROJECT LIBRARY"
        title="项目包状态"
        description="读取本地项目包"
        actions={<button>重新扫描</button>}
      >
        <div>项目清单</div>
      </PlatformPage>,
    );

    expect(screen.getByRole('main', { name: '项目包状态' })).toHaveAttribute(
      'data-description',
      '读取本地项目包',
    );
    // 页面标题必须是真实 heading：既服务无障碍，也是 E2E 定位页面的依据。
    expect(screen.getByRole('heading', { name: '项目包状态', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('PROJECT LIBRARY')).toBeInTheDocument();
    expect(screen.getByText('读取本地项目包')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeInTheDocument();
    expect(screen.getByText('项目清单')).toBeInTheDocument();
  });

  it('省略可选文案时只渲染标题', () => {
    render(
      <PlatformPage title="控制台">
        <div>内容</div>
      </PlatformPage>,
    );

    expect(screen.getByRole('heading', { name: '控制台', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '控制台' })).not.toHaveAttribute('data-description');
  });
});
