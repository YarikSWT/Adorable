import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "user-api-key";
const COOKIE_PROVIDER = "user-api-provider";

/** Check if a global API key is configured in the environment.
 *  Must stay in sync with the `hasGlobalKey` branch in
 *  `app/api/chat/route.ts`. */
function hasGlobalKey(): boolean {
  return !!(
    process.env.Z_AI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    (process.env.LLM_PROVIDER ?? "").toLowerCase() === "mock"
  );
}

/** GET – returns whether the user needs to provide a key */
export async function GET() {
  const jar = await cookies();
  const userKey = jar.get(COOKIE_NAME)?.value;
  const userProvider = jar.get(COOKIE_PROVIDER)?.value ?? "openai";

  return NextResponse.json({
    hasGlobalKey: hasGlobalKey(),
    hasUserKey: !!userKey,
    provider: userProvider,
  });
}

/** POST – save or delete the user's API key */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    apiKey?: string;
    provider?: "openai" | "anthropic";
    action?: "save" | "delete";
  };

  const jar = await cookies();

  if (body.action === "delete") {
    jar.delete(COOKIE_NAME);
    jar.delete(COOKIE_PROVIDER);
    return NextResponse.json({ ok: true });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  const provider = body.provider ?? "openai";

  // Basic validation
  if (provider === "openai" && !apiKey.startsWith("sk-")) {
    return NextResponse.json(
      { error: "OpenAI keys start with sk-" },
      { status: 400 },
    );
  }

  jar.set(COOKIE_NAME, apiKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });

  jar.set(COOKIE_PROVIDER, provider, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
