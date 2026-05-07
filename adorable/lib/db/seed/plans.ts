// Free plan seed. Limits per Doc 2 §4.2.

import { db } from "../client";
import { plans } from "../schema/billing";

export const seedPlans = async (): Promise<void> => {
  await db
    .insert(plans)
    .values({
      slug: "free",
      name: "Free",
      monthlyPriceCents: 0,
      isPublic: true,
      limits: {
        "llm.tokens.monthly": 100_000,
        "image.generations.monthly": 10,
        "stt.minutes.monthly": 5,
        "tts.chars.monthly": 5_000,
        "projects.max": 1,
        "members_per_project.max": 1,
      },
      features: { custom_domains: false },
    })
    .onConflictDoNothing({ target: plans.slug });
};
