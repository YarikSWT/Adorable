"use client";

import { createContext, useContext } from "react";

export type ProjectConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectConversationsContextValue = {
  repoId: string | null;
  conversations: ProjectConversation[];
  onSelectConversation: (conversationId: string) => void;
  /** Currently active conversation, used to highlight в UI. */
  activeConversationId?: string | null;
};

const ProjectConversationsContext =
  createContext<ProjectConversationsContextValue>({
    repoId: null,
    conversations: [],
    onSelectConversation: () => {},
    activeConversationId: null,
  });

export const ProjectConversationsProvider =
  ProjectConversationsContext.Provider;

export const useProjectConversations = () =>
  useContext(ProjectConversationsContext);
