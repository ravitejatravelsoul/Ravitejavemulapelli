import { NextResponse } from "next/server";
import { contactSchema } from "@/lib/validation/contact";
import { contactService } from "@/lib/services/contact.service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await contactService.send(parsed.data);

  if (!result.success) {
    return NextResponse.json({ success: false }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
