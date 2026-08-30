import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, unauthorizedResponse } from "@/lib/auth";

const MAX_BYTES_BY_TYPE: Record<string, number> = {
  photo: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 50 * 1024 * 1024,
};

const MIME_PREFIX_BY_TYPE: Record<string, string> = {
  photo: "image/",
  video: "video/",
};

function inferMediaType(mime: string): "photo" | "video" | "document" {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return unauthorizedResponse();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const requestedType = formData.get("media_type") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const mediaType = requestedType && MAX_BYTES_BY_TYPE[requestedType]
    ? (requestedType as "photo" | "video" | "document")
    : inferMediaType(file.type || "");

  const expectedPrefix = MIME_PREFIX_BY_TYPE[mediaType];
  if (expectedPrefix && file.type && !file.type.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: `File does not look like a ${mediaType}.` },
      { status: 400 }
    );
  }

  const maxBytes = MAX_BYTES_BY_TYPE[mediaType] ?? MAX_BYTES_BY_TYPE.document;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `File is too large for ${mediaType} (max ${Math.round(maxBytes / 1024 / 1024)}MB).` },
      { status: 400 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const storageKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;

  const supabase = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("telegram-media")
    .upload(storageKey, bytes, { contentType: file.type || undefined, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage.from("telegram-media").getPublicUrl(storageKey);

  return NextResponse.json({
    ok: true,
    storage_key: storageKey,
    media_type: mediaType,
    public_url: publicUrlData.publicUrl,
  });
}
