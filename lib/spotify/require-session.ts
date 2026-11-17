import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "./session";

export async function requireSession() {
  let session;
  try { session = await readSession(); } catch { redirect("/?auth_error=configuration"); }
  if (!session) redirect("/?auth_error=expired");
}
