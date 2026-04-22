// Gitea GitProvider через REST API v1.
//
// STATUS: ПЛЕЙСХОЛДЕР. Полноценная реализация — в следующей итерации
// Phase 3. Пока что `createGiteaGitProvider()` бросает, указывая
// на это. Это даёт CI возможность компилироваться и гарантирует, что
// mock-провайдер — единственный рабочий путь, пока gitea-часть не
// готова.
//
// Задачи для следующей итерации:
//   - createRepo (admin-org repos/create + import-from-url)
//   - getRepo: branches/default, contents/<path>, commits, files
//   - githubSync: push-mirror setup через /repos/{owner}/{repo}/push_mirrors
//   - requires GITEA_TOKEN + GITEA_BASE_URL + GITEA_ORG в env

import type { GitProvider } from "./git";

export const createGiteaGitProvider = (): GitProvider => {
  throw new Error(
    "git-gitea: not implemented yet. Set GIT_PROVIDER=mock for tests, " +
      "or wait for Phase 3 Gitea implementation.",
  );
};
