import { redirect } from "next/navigation";

// The review inbox is now part of "Needs you"; keep old links working.
export default async function ReviewInboxPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  redirect(`/apps/${appId}/inbox`);
}
