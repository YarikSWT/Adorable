// OAuth provider configs for Better Auth's generic-oauth plugin.
//
// Google is wired through Better Auth's built-in `socialProviders.google`
// (see better-auth.ts) — no entry here. Yandex and VK don't ship as built-ins,
// so we describe them by URL + scope + a `mapProfileToUser` that pulls the
// fields we actually store.

import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

type ProfileMapper = NonNullable<GenericOAuthConfig["mapProfileToUser"]>;

const yandexProfile: ProfileMapper = (profile) => {
  const id = String(profile["id"] ?? "");
  const email = (profile["default_email"] ?? profile["emails"]?.[0]) as
    | string
    | undefined;
  const name =
    (profile["real_name"] as string | undefined) ??
    (profile["display_name"] as string | undefined) ??
    (profile["login"] as string | undefined) ??
    "";
  const avatarId = profile["default_avatar_id"] as string | undefined;
  return {
    id,
    email,
    name,
    image: avatarId
      ? `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`
      : null,
  };
};

const vkProfile: ProfileMapper = (profile) => {
  // VK ID returns { user: { user_id, first_name, last_name, email, avatar } }
  const user = (profile["user"] ?? profile) as Record<string, unknown>;
  const id = String(user["user_id"] ?? user["id"] ?? "");
  const first = (user["first_name"] as string | undefined) ?? "";
  const last = (user["last_name"] as string | undefined) ?? "";
  const name = [first, last].filter(Boolean).join(" ").trim();
  const email = user["email"] as string | undefined;
  const avatar = (user["avatar"] ?? user["photo_200"]) as string | undefined;
  return { id, email, name, image: avatar ?? null };
};

export const yandexOAuth: GenericOAuthConfig = {
  providerId: "yandex",
  authorizationUrl: "https://oauth.yandex.ru/authorize",
  tokenUrl: "https://oauth.yandex.ru/token",
  userInfoUrl: "https://login.yandex.ru/info?format=json",
  clientId: process.env.YANDEX_CLIENT_ID ?? "",
  clientSecret: process.env.YANDEX_CLIENT_SECRET ?? "",
  scopes: ["login:email", "login:info"],
  mapProfileToUser: yandexProfile,
};

export const vkOAuth: GenericOAuthConfig = {
  providerId: "vk",
  authorizationUrl: "https://id.vk.com/authorize",
  tokenUrl: "https://id.vk.com/oauth2/auth",
  userInfoUrl: "https://id.vk.com/oauth2/user_info",
  clientId: process.env.VK_CLIENT_ID ?? "",
  clientSecret: process.env.VK_CLIENT_SECRET ?? "",
  scopes: ["email"],
  // VK ID requires PKCE — without it the flow fails silently with
  // "invalid_request".
  pkce: true,
  mapProfileToUser: vkProfile,
};

// Only pass through providers whose env credentials are present. Better Auth
// will register them as endpoints — registering with empty clientId leaks a
// route that always 500s on use.
export const enabledGenericOAuthProviders = (): GenericOAuthConfig[] => {
  const out: GenericOAuthConfig[] = [];
  if (process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET) {
    out.push(yandexOAuth);
  }
  if (process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET) {
    out.push(vkOAuth);
  }
  return out;
};
