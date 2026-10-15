import { notFound } from "next/navigation";
import { getPrisma } from "@/server/db";

export default async function ApplicationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const app = await getPrisma().application.findUnique({ where: { id: appId }, select: { id: true } });
  if (!app) notFound();
  return children;
}
