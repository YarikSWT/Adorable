"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Doc 3 §6.4: keep the button visible but stub the handler — invitations land
// in a future spec. Closing the modal restores the page state untouched.
export function MembersAddStub() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        + Добавить участника
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
        >
          <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-md">
            <h2 className="mb-2 text-base font-semibold">
              Приглашения скоро появятся
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              В этой версии участников добавляет администратор через support.
              Email-приглашения будут в следующем релизе.
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setOpen(false)}>
                Понятно
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
