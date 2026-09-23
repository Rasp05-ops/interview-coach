import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
export async function GET(req: NextRequest) { const user = getAuthUser(req); return user ? NextResponse.json({ user }) : NextResponse.json({ error: "Authentication required" }, { status: 401 }); }
