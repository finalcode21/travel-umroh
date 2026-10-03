import { NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/session";
import { markAllNotificationsRead } from "@/core/notification/service";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (user?.status === "ACTIVE") {
    await markAllNotificationsRead(user.companyId, user.id);
  }
  return NextResponse.redirect(new URL(req.headers.get("referer") ?? "/dashboard", req.url), {
    status: 303,
  });
}
