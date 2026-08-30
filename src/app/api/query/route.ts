import { createQueryPostHandler } from "@/agent/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = createQueryPostHandler();
