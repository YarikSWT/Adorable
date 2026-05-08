"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Shape of /api/me — matches app/api/me/route.ts and is consumed by every
// shell component (Header / OrgSwitcher / UserMenu / EmailVerifyBanner).
//
// `null` = anonymous (no session cookie or expired); the shell hides itself.
// `undefined` (loading) = before the first fetch settles. We render a skinny
// header skeleton in that case so the layout doesn't jump on hydration.

export type MeUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  status: string;
};

export type MeOrganization = {
  id: string;
  slug: string;
  name: string;
  type: "personal" | "team";
  role: string;
  subscription:
    | { planSlug: string; currentPeriodEnd: string | null }
    | null;
};

export type Me = {
  user: MeUser;
  organizations: MeOrganization[];
};

type Ctx = {
  me: Me | null | undefined;
  refresh: () => Promise<void>;
};

const MeContext = createContext<Ctx>({
  me: undefined,
  refresh: async () => undefined,
});

export const useMe = (): Ctx => useContext(MeContext);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Me;
        setMe(data);
      } else if (res.status === 401) {
        setMe(null);
      } else {
        setMe(null);
      }
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(() => ({ me, refresh }), [me]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
