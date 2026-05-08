"use client";

import type { FC } from "react";

// One conversation per project: there is no longer a list to render here.
// AssistantUI wraps this in its thread-welcome frame; the visible bits
// come from the surrounding chat composer + history.
export const RepoWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex flex-col items-center justify-center px-4 text-center">
          <h1 className="aui-thread-welcome-message-inner animate-in text-2xl font-semibold tracking-tight duration-300 fade-in slide-in-from-bottom-2 md:text-3xl">
            {""}
          </h1>
        </div>
      </div>
    </div>
  );
};
