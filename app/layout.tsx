import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '错见 · 错题复盘簿',
  description: '为公考错题记录、检索与复盘设计的本地学习工具。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
