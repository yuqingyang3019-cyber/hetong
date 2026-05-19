import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "合同生成工作台",
  description: "上传报价单、确认合同字段并生成合同草稿",
  applicationName: "合同生成工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
