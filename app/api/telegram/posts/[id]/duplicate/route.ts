import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";
import { duplicatePost } from "@/lib/telegram/publishing-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const { id } = await params;

  try {
    const newPostId = await duplicatePost(id);
    return NextResponse.json({ ok: true, postId: newPostId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to duplicate post." },
      { status: 400 }
    );
  }
}
